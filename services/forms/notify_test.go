package forms

import (
	"io"
	"mime"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// A notification with SITE_META names the article by its title and links to it; without what it needs it is the
// replaced service's (CONTRACT.md C12, "The Go service").
func TestNotificationNamesTheArticle(t *testing.T) {
	type sent struct{ title, body, click string }
	var got sent
	ntfy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		title, _ := new(mime.WordDecoder).DecodeHeader(r.Header.Get("X-Title"))
		got = sent{title, string(body), r.Header.Get("X-Click")}
	}))
	defer ntfy.Close()
	meta := filepath.Join(t.TempDir(), "meta.json")
	os.WriteFile(meta, []byte(`{"origin":"https://example.org","language":"de","articles":[
		{"id":"a","lang":"de","title":"Über Bündel","path":"/ueber-buendel/"},
		{"id":"a","lang":"en","title":"About bundles","path":"/en/about-bundles/"}]}`), 0o644)

	for _, c := range []struct {
		name, siteMeta, article, language string
		want                              sent
	}{
		{"by title", meta, "a", "de", sent{"Neuer Kommentar: Über Bündel", "Nora: Hallo", "https://example.org/ueber-buendel/"}},
		{"in its language", meta, "a", "en", sent{"Neuer Kommentar: About bundles", "Nora: Hallo", "https://example.org/en/about-bundles/"}},
		{"an unknown article", meta, "b", "de", sent{"Neuer Kommentar", "Nora → b\nHallo", ""}},
		{"no meta.json", filepath.Join(t.TempDir(), "missing.json"), "a", "de", sent{"Neuer Kommentar", "Nora → a\nHallo", ""}},
		{"without SITE_META", "", "a", "de", sent{"Neuer Kommentar", "Nora → a\nHallo", ""}},
	} {
		notifier(Config{NtfyURL: ntfy.URL, NtfyToken: "t", SiteMeta: c.siteMeta})("Nora", c.article, c.language, "Hallo")
		if got != c.want {
			t.Errorf("%s: %+v, want %+v", c.name, got, c.want)
		}
	}
}

func TestNotificationInEnglishForASiteNotInGerman(t *testing.T) {
	meta := filepath.Join(t.TempDir(), "meta.json")
	os.WriteFile(meta, []byte(`{"origin":"https://example.org","language":"en","articles":[{"id":"a","lang":"en","title":"T","path":"/t/"}]}`), 0o644)
	found, err := lookUp(meta, "a", "en")
	if err != nil || found.newComment() != "New comment" {
		t.Errorf("%+v %v", found, err)
	}
	os.WriteFile(meta, []byte(`{"origin":"javascript:alert(1)","language":"en","articles":[]}`), 0o644)
	if _, err := lookUp(meta, "a", "en"); err == nil {
		t.Error("took an origin that is no http or https URL")
	}
}
