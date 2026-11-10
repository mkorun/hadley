//go:build unix || windows

package forms

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type hardEndRequest struct {
	URL  string
	Body []byte
}

func TestHardEndKeepsAnAnsweredSubmission(t *testing.T) {
	dir := t.TempDir()
	program, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	child := exec.CommandContext(ctx, program, "-test.run=^TestHardEndChild$")
	child.Env = append(os.Environ(), "HADLEY_TEST_HARD_END_DIR="+dir)
	child.Stderr = os.Stderr
	output, err := child.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	waited := false
	t.Cleanup(func() {
		if !waited {
			child.Process.Kill()
			child.Wait()
		}
	})
	var request hardEndRequest
	if err := json.NewDecoder(output).Decode(&request); err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Timeout: 10 * time.Second}
	response, err := client.Post(request.URL+"/api/comment/submit", "application/json", bytes.NewReader(request.Body))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("submission: %d", response.StatusCode)
	}
	// SIGKILL on Unix, TerminateProcess on Windows: no shutdown handler can finish a pending write.
	if err := child.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	err = child.Wait()
	waited = true
	if err == nil {
		t.Fatal("child exited successfully instead of being killed")
	}
	releaseTestLocks(t)
	if err := LockDataDir(dir); err != nil {
		t.Fatal(err)
	}
	restarted := testServiceAt(t, dir)
	body, err := parseJSON(request.Body)
	if err != nil {
		t.Fatal(err)
	}
	nonce := field(field(field(body, "altcha"), "challenge"), "parameters")
	if !restarted.replay.seen(field(nonce, "nonce").(string), time.Now()) {
		t.Error("answered submission is missing from the replay store after a hard end")
	}
	comments, err := readRecords(filepath.Join(dir, queueFile))
	if err != nil {
		t.Fatal(err)
	}
	if len(comments) != 1 || field(comments[0], "text") != "t" || field(comments[0], "article_id") != "a" {
		t.Errorf("answered submission is missing from the queue after a hard end: %v", comments)
	}
	again := httptest.NewRecorder()
	restarted.ServeHTTP(again, httptest.NewRequest(http.MethodPost, "/api/comment/submit", bytes.NewReader(request.Body)))
	if again.Code != http.StatusUnprocessableEntity || !strings.Contains(again.Body.String(), "Challenge already used") {
		t.Errorf("replayed submission after restart: %d %s", again.Code, again.Body)
	}
}

func TestHardEndChild(t *testing.T) {
	dir := os.Getenv("HADLEY_TEST_HARD_END_DIR")
	if dir == "" {
		return
	}
	if err := LockDataDir(dir); err != nil {
		t.Fatal(err)
	}
	service := testServiceAt(t, dir)
	body := solvedBody(t, service)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		service.ServeHTTP(pauseAfterSuccess{w}, r)
	}))
	if err := json.NewEncoder(os.Stdout).Encode(hardEndRequest{URL: server.URL, Body: body}); err != nil {
		t.Fatal(err)
	}
	select {} // the parent kills this process
}

type pauseAfterSuccess struct{ http.ResponseWriter }

func (w pauseAfterSuccess) WriteHeader(status int) {
	w.ResponseWriter.WriteHeader(status)
	if status >= 200 && status < 300 {
		w.ResponseWriter.(http.Flusher).Flush()
		select {} // expose a write moved after the answer, without racing the parent
	}
}
