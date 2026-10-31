package forms

import (
	"bytes"
	"errors"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// The comments waiting for moderation (CONTRACT.md C8, C9): DATA_DIR/comments.json, a JSON record per line, which a
// download renames to DATA_DIR/comments_out.json, the frozen batch, until the admin deletes it. The names and the
// format are the replaced service's, so that either service can take over the other's files.

const (
	queueFile  = "comments.json"
	frozenFile = "comments_out.json"
)

var errQueueFull = errors.New("queue full")

type queue struct {
	mu  sync.Mutex // one change of the files at a time: an append, a freeze, a deletion
	dir string
}

// add appends record as a line, unless the queue already holds maxBytes or maxEntries non-blank lines. Once the line
// is written the record is in the queue: a failing sync or close is logged, not reported, so that a client is not
// told to send again what is stored.
func (q *queue) add(record []byte, maxBytes, maxEntries float64) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	path := filepath.Join(q.dir, queueFile)
	if data, err := os.ReadFile(path); err == nil {
		if float64(len(data)) >= maxBytes || float64(len(nonBlankLines(data))) >= maxEntries {
			return errQueueFull
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0o600)
	if err != nil {
		return err
	}
	if _, err := file.Write(append(record, '\n')); err != nil {
		file.Close()
		return err
	}
	if err := errors.Join(file.Sync(), file.Close()); err != nil {
		log.Printf("[queue] %s: a record was written, but: %v", path, err)
	}
	return nil
}

// take returns the frozen batch, and whether it was frozen before (resumed); without one it freezes the queue first.
// No queue: no comments.
func (q *queue) take() (resumed bool, comments []any, err error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	frozen := filepath.Join(q.dir, frozenFile)
	if _, err := os.Stat(frozen); err == nil {
		comments, err := readRecords(frozen)
		return true, comments, err
	} else if !os.IsNotExist(err) {
		return false, nil, err
	}
	if err := os.Rename(filepath.Join(q.dir, queueFile), frozen); err != nil {
		if os.IsNotExist(err) {
			return false, []any{}, nil
		}
		return false, nil, err
	}
	comments, err = readRecords(frozen)
	return false, comments, err
}

// drop deletes the frozen batch. Failing to, it says nothing, as the replaced service does (a finding of CONTRACT.md).
func (q *queue) drop() {
	q.mu.Lock()
	defer q.mu.Unlock()
	_ = os.Remove(filepath.Join(q.dir, frozenFile))
}

func readRecords(path string) ([]any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	records := []any{}
	for _, line := range nonBlankLines(data) {
		record, err := parseJSON(line)
		if err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, nil
}

// nonBlankLines splits data at LF and keeps the lines with more than JavaScript white space.
func nonBlankLines(data []byte) [][]byte {
	var lines [][]byte
	for line := range bytes.SplitSeq(data, []byte("\n")) {
		if strings.TrimFunc(string(line), isSpaceJS) != "" {
			lines = append(lines, line)
		}
	}
	return lines
}
