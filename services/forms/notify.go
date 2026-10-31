package forms

import (
	"encoding/json"
	"errors"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
	"unicode/utf16"
)

// notifier posts each accepted comment to ntfy (CONTRACT.md C12) when NTFY_URL and NTFY_TOKEN are both set; nil
// otherwise. Failures are not reported, as in the replaced service; a request gives up after ten seconds.
//
// With SITE_META, the site's meta.json (written by hadley next to a publish build, put beside the releases by the
// deploy), the notification names the article by its title, in the site's language, and opens it when tapped; the
// file is read for each notification, so a deploy counts at once. Without it, or when it cannot name the article, the
// notification is the replaced service's.
func notifier(c Config) func(name, article, language, text string) {
	if c.NtfyURL == "" || c.NtfyToken == "" {
		return nil
	}
	client := &http.Client{Timeout: 10 * time.Second}
	return func(name, article, language, text string) {
		title, body, click := "Neuer Kommentar", name+" → "+article+"\n"+preview(text), ""
		if c.SiteMeta != "" {
			if found, err := lookUp(c.SiteMeta, article, language); err != nil {
				log.Printf("[ntfy] %s: %v", c.SiteMeta, err)
			} else if found != nil {
				title = found.newComment() + ": " + found.Title
				body, click = name+": "+preview(text), found.url
			}
		}
		request, err := http.NewRequest(http.MethodPost, c.NtfyURL, strings.NewReader(body))
		if err != nil {
			return
		}
		request.Header.Set("Authorization", "Bearer "+c.NtfyToken)
		request.Header.Set("X-Title", mime.BEncoding.Encode("UTF-8", title)) // ntfy decodes RFC 2047
		request.Header.Set("X-Tags", "speech_balloon")
		request.Header.Set("Content-Type", "text/plain")
		if click != "" {
			request.Header.Set("X-Click", click)
		}
		if response, err := client.Do(request); err == nil {
			response.Body.Close()
		}
	}
}

// article is what meta.json says of an article in one language.
type article struct {
	Title    string
	url      string
	language string // the site's
}

func (a *article) newComment() string {
	if a.language == "de" {
		return "Neuer Kommentar"
	}
	return "New comment"
}

// lookUp finds the article `id` in `language` in the meta.json at path; nil when the file does not have it, an error
// when the file cannot be read or is not meta.json.
func lookUp(path, id, language string) (*article, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var meta struct {
		Origin   string
		Language string
		Articles []struct{ ID, Lang, Title, Path string }
	}
	if err := json.Unmarshal(data, &meta); err != nil {
		return nil, err
	}
	origin, err := url.Parse(meta.Origin)
	if err != nil || (origin.Scheme != "https" && origin.Scheme != "http") || origin.Host == "" {
		return nil, errors.New("its origin is no http or https URL")
	}
	for _, a := range meta.Articles {
		if a.ID == id && a.Lang == language && a.Title != "" && strings.HasPrefix(a.Path, "/") {
			return &article{Title: a.Title, url: strings.TrimSuffix(meta.Origin, "/") + a.Path, language: meta.Language}, nil
		}
	}
	return nil, nil
}

// preview is text up to 120 UTF-16 code units, and … when it was longer (JavaScript's slice, which can cut a pair).
func preview(text string) string {
	units := utf16.Encode([]rune(text))
	if len(units) <= 120 {
		return text
	}
	return string(utf16.Decode(units[:120])) + "…"
}
