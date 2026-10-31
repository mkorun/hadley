// Command hadley-forms runs hadley's comments service (services/forms/CONTRACT.md), configured by the environment.
//
//	hadley-forms [-dev]
//	hadley-forms -version
//
// -version prints the version a release build was stamped with (scripts/build-forms.ts), devel for any other build.
// -dev is for the service hadley dev starts: it creates DATA_DIR, and without ADMIN_TOKEN and HMAC_SECRET takes the
// secrets kept there, made on the first start (forms.LoadDevSecrets).
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/mkorun/hadley/services/forms"
)

// version is set by a release build: -ldflags "-X main.version=<version>".
var version = "devel"

func main() {
	log.SetFlags(0)
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	dev := flag.Bool("dev", false, "create DATA_DIR and keep made-up secrets in it, for hadley dev")
	printVersion := flag.Bool("version", false, "print the version and exit")
	flag.Parse()
	if *printVersion {
		fmt.Println("hadley-forms", version)
		return nil
	}
	lookup := os.LookupEnv
	if *dev {
		dataDir, _ := os.LookupEnv("DATA_DIR")
		if dataDir == "" {
			return errors.New("Missing required env variable: DATA_DIR")
		}
		if err := os.MkdirAll(dataDir, 0o700); err != nil {
			return err
		}
		if err := forms.LockDataDir(dataDir); err != nil {
			return err
		}
		secrets, err := forms.LoadDevSecrets(dataDir)
		if err != nil {
			return err
		}
		made := map[string]string{"ADMIN_TOKEN": secrets.AdminToken, "HMAC_SECRET": secrets.HMACSecret}
		lookup = func(key string) (string, bool) {
			if value, ok := os.LookupEnv(key); ok && value != "" {
				return value, ok
			}
			value, ok := made[key]
			return value, ok
		}
	}
	config, err := forms.ConfigFrom(lookup)
	if err != nil {
		return err
	}
	if !*dev {
		if err := forms.LockDataDir(config.DataDir); err != nil {
			return err
		}
	}
	service, err := forms.New(config)
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(config.Host, strconv.Itoa(config.Port)))
	if err != nil {
		return err
	}
	port := listener.Addr().(*net.TCPAddr).Port
	log.Printf("Hadley Forms Service — http://localhost:%d", port)

	stop := make(chan struct{})
	go service.Maintain(stop)
	// a client that sends slowly holds a connection for at most these times; the answer has no deadline, so that a
	// submission taken is not answered with a broken connection
	server := &http.Server{
		Handler:           service,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    64 << 10,
	}
	served := make(chan error, 1)
	go func() { served <- server.Serve(listener) }()

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	select {
	case err := <-served:
		return err
	case <-signals:
	}
	close(stop)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
