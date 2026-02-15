package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
)

//go:embed dist
var assets embed.FS

const (
	APP_PORT = 58888 // Fixed port for Single Instance check
)

// --- Win32 API Definitions for System Tray ---

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")
	shell32  = syscall.NewLazyDLL("shell32.dll")

	procRegisterClassExW      = user32.NewProc("RegisterClassExW")
	procCreateWindowExW       = user32.NewProc("CreateWindowExW")
	procDefWindowProcW        = user32.NewProc("DefWindowProcW")
	procGetMessageW           = user32.NewProc("GetMessageW")
	procTranslateMessage      = user32.NewProc("TranslateMessage")
	procDispatchMessageW      = user32.NewProc("DispatchMessageW")
	procPostQuitMessage       = user32.NewProc("PostQuitMessage")
	procLoadIconW             = user32.NewProc("LoadIconW")
	procLoadCursorW           = user32.NewProc("LoadCursorW")
	procShell_NotifyIconW     = shell32.NewProc("Shell_NotifyIconW")
	procCreatePopupMenu       = user32.NewProc("CreatePopupMenu")
	procAppendMenuW           = user32.NewProc("AppendMenuW")
	procTrackPopupMenu        = user32.NewProc("TrackPopupMenu")
	procGetCursorPos          = user32.NewProc("GetCursorPos")
	procSetForegroundWindow   = user32.NewProc("SetForegroundWindow")
	procDestroyMenu           = user32.NewProc("DestroyMenu")
	procGetConsoleWindow      = kernel32.NewProc("GetConsoleWindow")
	procGetModuleHandleW      = kernel32.NewProc("GetModuleHandleW")
	procShowWindow            = user32.NewProc("ShowWindow")
	procRegisterWindowMessage = user32.NewProc("RegisterWindowMessageW")
	procPostMessage           = user32.NewProc("PostMessageW")
)

const (
	WM_DESTROY       = 0x0002
	WM_COMMAND       = 0x0111
	WM_USER          = 0x0400
	WM_TRAY          = WM_USER + 1
	WM_LBUTTONUP     = 0x0202
	WM_LBUTTONDBLCLK = 0x0203
	WM_RBUTTONUP     = 0x0205
	WM_RBUTTONDBLCLK = 0x0206
	WM_NULL          = 0x0000

	NIM_ADD    = 0x00000000
	NIM_MODIFY = 0x00000001
	NIM_DELETE = 0x00000002

	NIF_MESSAGE = 0x00000001
	NIF_ICON    = 0x00000002
	NIF_TIP     = 0x00000004

	MF_STRING    = 0x00000000
	MF_SEPARATOR = 0x00000800

	TPM_RETURNCMD   = 0x0100
	TPM_RIGHTBUTTON = 0x0002

	IDI_APPLICATION = 32512
	IDC_ARROW       = 32512

	SW_HIDE = 0
)

type WNDCLASSEX struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     syscall.Handle
	hIcon         syscall.Handle
	hCursor       syscall.Handle
	hbrBackground syscall.Handle
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       syscall.Handle
}

type NOTIFYICONDATA struct {
	cbSize           uint32
	hWnd             syscall.Handle
	uID              uint32
	uFlags           uint32
	uCallbackMessage uint32
	hIcon            syscall.Handle
	szTip            [128]uint16
}

type POINT struct {
	X int32
	Y int32
}

type MSG struct {
	HWnd    syscall.Handle
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      POINT
}

// --- Data Structures ---

type FileData struct {
	FileName string `json:"fileName"`
	Data     string `json:"data"` // Base64 encoded content (only for CLI Handover/Initial Load)
}

type ScreenshotRequest struct {
	Html  string `json:"html"`
	Width int    `json:"width"`
}

type PdfExportRequest struct {
	Html  string  `json:"html"`
	Path  string  `json:"path"`
	Scale float64 `json:"scale"` // Scale factor (e.g., 1.0 for 100%)
}

type DialogResponse struct {
	Path string `json:"path"`
}

type LockRequest struct {
	Path string `json:"path"`
}

// Store for files handed over from secondary instances
// Map ID -> FileData
var (
	fileStore   = make(map[string]FileData)
	fileStoreMu sync.RWMutex
)

// Store for temporary HTML rendering (Screenshot/PDF)
// Map Token -> HTML String
var (
	renderStore   = make(map[string]string)
	renderStoreMu sync.RWMutex
)

// --- File Locking Global ---
var (
	activeFileHandles = make(map[string]*os.File)
	lockMu            sync.Mutex
)

// Used for API Handover to launch windows
var globalTargetUrl string

// --- Windows Native API for Dialogs (FAST) ---
var (
	modcomdlg32         = syscall.NewLazyDLL("comdlg32.dll")
	procGetOpenFileName = modcomdlg32.NewProc("GetOpenFileNameW")
	procGetSaveFileName = modcomdlg32.NewProc("GetSaveFileNameW")

	moduser32               = syscall.NewLazyDLL("user32.dll")
	procGetForegroundWindow = moduser32.NewProc("GetForegroundWindow")
)

type OPENFILENAME struct {
	lStructSize       uint32
	hwndOwner         uintptr
	hInstance         uintptr
	lpstrFilter       *uint16
	lpstrCustomFilter *uint16
	nMaxCustFilter    uint32
	nFilterIndex      uint32
	lpstrFile         *uint16
	nMaxFile          uint32
	lpstrFileTitle    *uint16
	nMaxFileTitle     uint32
	lpstrInitialDir   *uint16
	lpstrTitle        *uint16
	Flags             uint32
	nFileOffset       uint16
	nFileExtension    uint16
	lpstrDefExt       *uint16
	lCustData         uintptr
	lpfnHook          uintptr
	lpTemplateName    *uint16
	pvReserved        uintptr
	dwReserved        uint32
	FlagsEx           uint32
}

const (
	OFN_FILEMUSTEXIST   = 0x00001000
	OFN_PATHMUSTEXIST   = 0x00000800
	OFN_OVERWRITEPROMPT = 0x00000002
	OFN_NOCHANGEDIR     = 0x00000008
)

func utf16PtrFromString(s string) *uint16 {
	p, _ := syscall.UTF16PtrFromString(s)
	return p
}

func getNativeOpenDialog() (string, error) {
	var ofn OPENFILENAME
	ofn.lStructSize = uint32(unsafe.Sizeof(ofn))

	// Get foreground window to ensure dialog opens on top of the browser
	hwnd, _, _ := procGetForegroundWindow.Call()
	ofn.hwndOwner = hwnd

	// Buffer for file path - INCREASED SIZE for deep paths
	buf := make([]uint16, 4096)
	ofn.lpstrFile = &buf[0]
	ofn.nMaxFile = uint32(len(buf))

	// Strict Filters: Added images to supported files
	filter := "Supported Files\x00*.html;*.htm;*.docx;*.pdf;*.md;*.markdown;*.txt;*.png;*.jpg;*.jpeg;*.webp;*.bmp\x00HTML Files (*.html;*.htm)\x00*.html;*.htm\x00Word Documents (*.docx)\x00*.docx\x00PDF Files (*.pdf)\x00*.pdf\x00Image Files\x00*.png;*.jpg;*.jpeg;*.webp;*.bmp\x00Markdown Files (*.md)\x00*.md\x00Text Files (*.txt)\x00*.txt\x00\x00"

	ofn.lpstrFilter = utf16PtrFromString(filter)
	ofn.nFilterIndex = 1
	ofn.lpstrTitle = utf16PtrFromString("Open File")
	ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR

	ret, _, _ := procGetOpenFileName.Call(uintptr(unsafe.Pointer(&ofn)))
	if ret == 0 {
		return "", fmt.Errorf("cancelled")
	}

	return syscall.UTF16ToString(buf), nil
}

func getNativeSaveDialog(filterType string) (string, error) {
	var ofn OPENFILENAME
	ofn.lStructSize = uint32(unsafe.Sizeof(ofn))

	// Get foreground window
	hwnd, _, _ := procGetForegroundWindow.Call()
	ofn.hwndOwner = hwnd

	buf := make([]uint16, 4096)
	ofn.lpstrFile = &buf[0]
	ofn.nMaxFile = uint32(len(buf))

	var filter string
	var defExt string

	// Dynamically set filter and default extension based on request
	if filterType == "pdf" {
		filter = "PDF Files (*.pdf)\x00*.pdf\x00\x00"
		defExt = "pdf"
	} else if filterType == "md" {
		filter = "Markdown Files (*.md)\x00*.md\x00\x00"
		defExt = "md"
	} else {
		filter = "HTML Files (*.html)\x00*.html\x00\x00"
		defExt = "html"
	}

	ofn.lpstrFilter = utf16PtrFromString(filter)
	ofn.nFilterIndex = 1
	ofn.lpstrTitle = utf16PtrFromString("Save As")
	ofn.lpstrDefExt = utf16PtrFromString(defExt)
	ofn.Flags = OFN_OVERWRITEPROMPT | OFN_NOCHANGEDIR

	ret, _, _ := procGetSaveFileName.Call(uintptr(unsafe.Pointer(&ofn)))
	if ret == 0 {
		return "", fmt.Errorf("cancelled")
	}

	return syscall.UTF16ToString(buf), nil
}

// --- File Locking Logic ---

func getLockKey(path string) string {
	if runtime.GOOS == "windows" {
		return strings.ToLower(filepath.Clean(path))
	}
	return filepath.Clean(path)
}

// lockFile opens the file and keeps the handle. On Windows, this prevents deletion.
func lockFile(path string) {
	lockMu.Lock()
	defer lockMu.Unlock()

	key := getLockKey(path)
	if _, exists := activeFileHandles[key]; exists {
		return // Already locked
	}

	// Open in read-only mode to hold the handle
	// On Windows, simply holding an open file handle (without FILE_SHARE_DELETE) prevents deletion
	f, err := os.Open(path)
	if err == nil {
		activeFileHandles[key] = f
		// log.Printf("[Lock] File locked: %s", path)
	} else {
		// log.Printf("[Lock] Failed to lock file: %v", err)
	}
}

// unlockFile releases the file handle, allowing write operations (save)
func unlockFile(path string) {
	lockMu.Lock()
	defer lockMu.Unlock()

	key := getLockKey(path)
	if f, exists := activeFileHandles[key]; exists {
		f.Close()
		delete(activeFileHandles, key)
		// log.Printf("[Lock] File unlocked: %s", path)
	}
}

func unlockAll() {
	lockMu.Lock()
	defer lockMu.Unlock()

	for key, f := range activeFileHandles {
		f.Close()
		delete(activeFileHandles, key)
	}
}

// --- Header Encoding Helper ---
// Encodes a string for safe use in HTTP headers (escapes non-ASCII),
// replacing '+' with '%20' to ensure spaces are handled correctly by JS decodeURIComponent.
func encodeHeaderValue(s string) string {
	return strings.ReplaceAll(url.QueryEscape(s), "+", "%20")
}

func main() {
	// 1. Hide Console on Windows Start
	if runtime.GOOS == "windows" {
		hwnd, _, _ := procGetConsoleWindow.Call()
		if hwnd != 0 {
			procShowWindow.Call(hwnd, SW_HIDE)
		}
	}

	targetUrl := fmt.Sprintf("http://127.0.0.1:%d", APP_PORT)
	globalTargetUrl = targetUrl

	// 2. Try to Listen on Fixed Port
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", APP_PORT))

	if err != nil {
		// Port busy, hand over to primary instance
		if len(os.Args) > 1 {
			filePath := os.Args[1]
			absPath, _ := filepath.Abs(filePath)

			if info, err := os.Stat(absPath); err == nil && !info.IsDir() {
				content, err := os.ReadFile(absPath)
				if err == nil {
					payload := FileData{
						FileName: absPath,
						Data:     base64.StdEncoding.EncodeToString(content),
					}
					jsonData, _ := json.Marshal(payload)

					client := http.Client{Timeout: 2 * time.Second}
					resp, postErr := client.Post(targetUrl+"/api/cli-handover", "application/json", bytes.NewBuffer(jsonData))
					if postErr == nil {
						resp.Body.Close()
						return
					}
				}
			}
		} else {
			// If already running and no file passed, open a new blank window/tab
			openDefaultBrowser(targetUrl)
		}
		return
	}

	// --- PRIMARY INSTANCE LOGIC ---

	var initialID string
	if len(os.Args) > 1 {
		filePath := os.Args[1]
		absPath, _ := filepath.Abs(filePath)

		if info, err := os.Stat(absPath); err == nil && !info.IsDir() {
			// Note: We do NOT lock initially. File starts clean/unlocked.
			content, err := os.ReadFile(absPath)
			if err == nil {
				finalContent := content
				ext := strings.ToLower(filepath.Ext(absPath))
				if ext == ".html" || ext == ".htm" {
					processed := inlineLocalImages(string(content), absPath)
					finalContent = []byte(processed)
				}

				initialID = generateID()
				fileStoreMu.Lock()
				fileStore[initialID] = FileData{
					FileName: absPath,
					Data:     base64.StdEncoding.EncodeToString(finalContent),
				}
				fileStoreMu.Unlock()
			}
		}
	}

	fsys, err := fs.Sub(assets, "dist")
	if err != nil {
		log.Fatal(err)
	}

	// Setup Routes
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		if r.URL.Path == "/api/kill" {
			unlockAll()
			go func() {
				time.Sleep(100 * time.Millisecond)
				os.Exit(0)
			}()
			w.WriteHeader(http.StatusOK)
			return
		}

		// Explicit File Lock API
		if r.URL.Path == "/api/file/lock" && r.Method == "POST" {
			var req LockRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err == nil && req.Path != "" {
				lockFile(req.Path)
			}
			w.WriteHeader(http.StatusOK)
			return
		}

		// Explicit File Unlock API
		if r.URL.Path == "/api/file/unlock" && r.Method == "POST" {
			var req LockRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err == nil && req.Path != "" {
				unlockFile(req.Path)
			}
			w.WriteHeader(http.StatusOK)
			return
		}

		if r.URL.Path == "/api/dialog/open" {
			path, err := getNativeOpenDialog()
			w.Header().Set("Content-Type", "application/json")
			if err != nil {
				json.NewEncoder(w).Encode(DialogResponse{Path: ""})
				return
			}
			json.NewEncoder(w).Encode(DialogResponse{Path: path})
			return
		}

		if r.URL.Path == "/api/dialog/save" {
			// Read filter param from URL
			filter := r.URL.Query().Get("filter")
			path, err := getNativeSaveDialog(filter)
			w.Header().Set("Content-Type", "application/json")
			if err != nil {
				json.NewEncoder(w).Encode(DialogResponse{Path: ""})
				return
			}
			json.NewEncoder(w).Encode(DialogResponse{Path: path})
			return
		}

		if r.URL.Path == "/api/cli-handover" && r.Method == "POST" {
			var payload FileData
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}

			dataBytes, err := base64.StdEncoding.DecodeString(payload.Data)
			if err == nil {
				ext := strings.ToLower(filepath.Ext(payload.FileName))
				if ext == ".html" || ext == ".htm" {
					processed := inlineLocalImages(string(dataBytes), payload.FileName)
					payload.Data = base64.StdEncoding.EncodeToString([]byte(processed))
				}
			}

			// Handover does not automatically lock.
			newID := generateID()
			fileStoreMu.Lock()
			fileStore[newID] = payload
			fileStoreMu.Unlock()

			go func() {
				url := fmt.Sprintf("%s/?fileId=%s", globalTargetUrl, newID)
				openDefaultBrowser(url)
			}()

			w.Write([]byte(newID))
			return
		}

		// Open File Endpoint - Returns Binary Stream
		if r.URL.Path == "/api/open-file" {
			paths := r.URL.Query()["path"]
			
			// 1. Handle Path Query (Direct Disk Access)
			if len(paths) > 0 {
				filePath := paths[0]
				if filePath == "" {
					http.Error(w, "Empty file path", http.StatusBadRequest)
					return
				}

				content, err := os.ReadFile(filePath)
				if err != nil {
					http.Error(w, fmt.Sprintf("Failed to read file: %v", err), http.StatusNotFound)
					return
				}

				finalContent := content
				ext := strings.ToLower(filepath.Ext(filePath))
				mimeType := "application/octet-stream"

				if ext == ".html" || ext == ".htm" {
					mimeType = "text/html"
					processed := inlineLocalImages(string(content), filePath)
					finalContent = []byte(processed)
				} else if ext == ".pdf" {
					mimeType = "application/pdf"
				} else if ext == ".docx" {
					mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
				}

				w.Header().Set("Content-Type", mimeType)
				// FIX: Encoding filename/path headers to prevent garbled text with Chinese characters
				w.Header().Set("X-File-Name", encodeHeaderValue(filepath.Base(filePath)))
				w.Header().Set("X-File-Path", encodeHeaderValue(filePath))
				w.Header().Set("Content-Length", fmt.Sprintf("%d", len(finalContent)))
				
				w.Write(finalContent)
				return
			}

			// 2. Handle FileID Query (Memory Store / CLI Handover)
			ids := r.URL.Query()["fileId"]
			targetID := ""
			if len(ids) > 0 {
				targetID = ids[0]
			}

			fileStoreMu.RLock()
			data, ok := fileStore[targetID]
			fileStoreMu.RUnlock()

			if ok {
				decoded, err := base64.StdEncoding.DecodeString(data.Data)
				if err != nil {
					http.Error(w, "Failed to decode stored file", http.StatusInternalServerError)
					return
				}
				
				ext := strings.ToLower(filepath.Ext(data.FileName))
				mimeType := "application/octet-stream"
				if ext == ".html" || ext == ".htm" {
					mimeType = "text/html"
				}

				w.Header().Set("Content-Type", mimeType)
				// FIX: Encoding filename/path headers
				w.Header().Set("X-File-Name", encodeHeaderValue(filepath.Base(data.FileName)))
				w.Header().Set("X-File-Path", encodeHeaderValue(data.FileName))
				w.Header().Set("Content-Length", fmt.Sprintf("%d", len(decoded)))
				w.Write(decoded)
			} else {
				http.Error(w, "File ID not found", http.StatusNotFound)
			}
			return
		}

		if r.URL.Path == "/api/render-view" {
			token := r.URL.Query().Get("token")
			renderStoreMu.RLock()
			html, ok := renderStore[token]
			renderStoreMu.RUnlock()

			if !ok {
				http.NotFound(w, r)
				return
			}

			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write([]byte(html))
			return
		}

		if r.URL.Path == "/api/export/screenshot" && r.Method == "POST" {
			var req ScreenshotRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid request body", http.StatusBadRequest)
				return
			}

			if req.Html == "" {
				http.Error(w, "HTML content is empty", http.StatusBadRequest)
				return
			}

			token := generateID()
			renderStoreMu.Lock()
			renderStore[token] = req.Html
			renderStoreMu.Unlock()

			defer func() {
				renderStoreMu.Lock()
				delete(renderStore, token)
				renderStoreMu.Unlock()
			}()

			renderURL := fmt.Sprintf("http://127.0.0.1:%d/api/render-view?token=%s", APP_PORT, token)

			opts := append(chromedp.DefaultExecAllocatorOptions[:],
				chromedp.NoFirstRun,
				chromedp.Headless,
				chromedp.DisableGPU,
				chromedp.IgnoreCertErrors,
			)

			if browserPath := findBrowserPath(); browserPath != "" {
				opts = append(opts, chromedp.ExecPath(browserPath))
			}

			allocCtx, cancel := chromedp.NewExecAllocator(context.Background(), opts...)
			defer cancel()

			ctx, cancel := context.WithTimeout(allocCtx, 30*time.Second)
			defer cancel()

			ctx, cancel = chromedp.NewContext(ctx)
			defer cancel()

			var buf []byte

			if err := chromedp.Run(ctx,
				chromedp.EmulateViewport(int64(req.Width), 1, chromedp.EmulateScale(3.0)),
				chromedp.Navigate(renderURL),
				chromedp.WaitVisible(".ProseMirror", chromedp.ByQuery),
				chromedp.Sleep(500*time.Millisecond),
				chromedp.FullScreenshot(&buf, 100),
			); err != nil {
				log.Println("Error taking screenshot:", err)
				http.Error(w, "Chromedp Error: "+err.Error(), http.StatusInternalServerError)
				return
			}

			w.Header().Set("Content-Type", "image/png")
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(buf)))
			w.Write(buf)
			return
		}

		// PDF Export Endpoint
		if r.URL.Path == "/api/export/pdf" && r.Method == "POST" {
			var req PdfExportRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid request body", http.StatusBadRequest)
				return
			}

			if req.Html == "" || req.Path == "" {
				http.Error(w, "HTML content or Path is empty", http.StatusBadRequest)
				return
			}

			token := generateID()
			renderStoreMu.Lock()
			renderStore[token] = req.Html
			renderStoreMu.Unlock()

			defer func() {
				renderStoreMu.Lock()
				delete(renderStore, token)
				renderStoreMu.Unlock()
			}()

			renderURL := fmt.Sprintf("http://127.0.0.1:%d/api/render-view?token=%s", APP_PORT, token)

			opts := append(chromedp.DefaultExecAllocatorOptions[:],
				chromedp.NoFirstRun,
				chromedp.Headless,
				chromedp.DisableGPU,
				chromedp.IgnoreCertErrors,
			)

			if browserPath := findBrowserPath(); browserPath != "" {
				opts = append(opts, chromedp.ExecPath(browserPath))
			}

			allocCtx, cancel := chromedp.NewExecAllocator(context.Background(), opts...)
			defer cancel()

			ctx, cancel := context.WithTimeout(allocCtx, 60*time.Second) // Longer timeout for PDF
			defer cancel()

			ctx, cancel = chromedp.NewContext(ctx)
			defer cancel()

			// Determine scale (Default 1.0)
			scale := req.Scale
			if scale <= 0 {
				scale = 1.0
			}

			var buf []byte

			if err := chromedp.Run(ctx,
				chromedp.Navigate(renderURL),
				chromedp.WaitVisible(".ProseMirror", chromedp.ByQuery),
				chromedp.Sleep(500*time.Millisecond), // Wait for fonts/images
				chromedp.ActionFunc(func(ctx context.Context) error {
					var err error
					// A4 Size: 8.27 x 11.69 inches
					buf, _, err = page.PrintToPDF().
						WithPrintBackground(true).
						WithPaperWidth(8.27).
						WithPaperHeight(11.69).
						WithMarginTop(0.4).
						WithMarginBottom(0.4).
						WithMarginLeft(0.4).
						WithMarginRight(0.4).
						WithScale(scale). // Apply scale from frontend
						Do(ctx)
					return err
				}),
			); err != nil {
				log.Println("Error generating PDF:", err)
				http.Error(w, "Chromedp Error: "+err.Error(), http.StatusInternalServerError)
				return
			}

			// Write directly to disk at req.Path
			if err := os.WriteFile(req.Path, buf, 0644); err != nil {
				log.Println("Error writing PDF file:", err)
				http.Error(w, "Failed to write PDF file", http.StatusInternalServerError)
				return
			}

			w.WriteHeader(http.StatusOK)
			return
		}

		// Save File Endpoint - Accepts Multipart Form Data
		if r.URL.Path == "/api/save-file" && r.Method == "POST" {
			// Increase limit to 128MB
			if err := r.ParseMultipartForm(128 << 20); err != nil {
				http.Error(w, "Failed to parse multipart form", http.StatusBadRequest)
				return
			}

			inputPath := r.FormValue("filePath")
			if inputPath == "" {
				http.Error(w, "File path is empty", http.StatusBadRequest)
				return
			}

			inputDir := filepath.Dir(inputPath)
			inputName := filepath.Base(inputPath)
			inputExt := filepath.Ext(inputName)
			inputNameNoExt := strings.TrimSuffix(inputName, inputExt)
			parentDirName := filepath.Base(inputDir)

			var finalDir string
			var finalHtmlPath string
			
			assets := r.MultipartForm.File["assets"]
			hasAssets := len(assets) > 0

			// --- SMART SAVING STRATEGY ---
			// 1. Markdown Files: Always use a sidecar folder (Filename_assets)
			// 2. HTML Files: Use bundling (Filename dir) only if instructed or consistent with current struct
			
			if strings.ToLower(inputExt) == ".md" || strings.ToLower(inputExt) == ".markdown" {
				// Markdown Strategy: Sidecar assets folder
				finalHtmlPath = inputPath
				finalDir = filepath.Join(inputDir, inputNameNoExt+"_assets")
				
				if hasAssets {
					if err := os.MkdirAll(finalDir, 0755); err != nil {
						http.Error(w, "Failed to create assets directory", http.StatusInternalServerError)
						return
					}
				}
			} else {
				// HTML Strategy
				shouldBundle := false
				if hasAssets {
					if !strings.EqualFold(parentDirName, inputNameNoExt) {
						shouldBundle = true
					}
				}

				if shouldBundle {
					finalDir = filepath.Join(inputDir, inputNameNoExt)
					if err := os.MkdirAll(finalDir, 0755); err != nil {
						http.Error(w, "Failed to create directory", http.StatusInternalServerError)
						return
					}
					finalHtmlPath = filepath.Join(finalDir, inputName)
				} else {
					finalDir = inputDir
					finalHtmlPath = inputPath
				}
			}

			// Save HTML/Content File
			htmlFile, _, err := r.FormFile("html")
			if err != nil {
				http.Error(w, "Content file part missing", http.StatusBadRequest)
				return
			}
			defer htmlFile.Close()

			// Unlocking before write allows overwriting if we held the lock.
			unlockFile(finalHtmlPath)

			outFile, err := os.Create(finalHtmlPath)
			if err != nil {
				// Re-acquire lock if we failed to write
				lockFile(finalHtmlPath) 
				
				// Send JSON error structure
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]string{
					"error": fmt.Sprintf("Failed to write file: %v. The file might be open in another program.", err),
				})
				return
			}
			
			_, err = io.Copy(outFile, htmlFile)
			outFile.Close()

			if err != nil {
				lockFile(finalHtmlPath)
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]string{
					"error": fmt.Sprintf("Failed to save content: %v", err),
				})
				return
			}

			// Save Assets
			if hasAssets {
				for _, fileHeader := range assets {
					src, err := fileHeader.Open()
					if err != nil {
						continue
					}
					
					// Save asset to finalDir (either _assets folder or bundled folder)
					assetPath := filepath.Join(finalDir, fileHeader.Filename)
					dst, err := os.Create(assetPath)
					if err == nil {
						io.Copy(dst, src)
						dst.Close()
					}
					src.Close()
				}
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(DialogResponse{Path: finalHtmlPath})
			return
		}

		http.FileServer(http.FS(fsys)).ServeHTTP(w, r)
	})

	// Start Server
	go func() {
		if err := http.Serve(listener, nil); err != nil {
			log.Fatal(err)
		}
	}()

	// Launch Browser: Ensures the browser opens on startup even if no file is provided.
	go func() {
		time.Sleep(200 * time.Millisecond)
		if initialID != "" {
			openDefaultBrowser(fmt.Sprintf("%s/?fileId=%s", targetUrl, initialID))
		} else {
			// Open Blank Editor
			openDefaultBrowser(targetUrl)
		}
	}()

	// 3. Run System Tray Message Loop (Blocks Main Thread)
	runTrayApp(targetUrl)
}

// --- Tray Application Logic ---

func runTrayApp(url string) {
	// FIX: Lock OS Thread to ensure message loop affinity and prevent handle leaks in the callback
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	if runtime.GOOS != "windows" {
		// Fallback for non-windows (dev mode)
		select {}
	}

	className := "WinHTML_Editor_Tray"
	classNamePtr, _ := syscall.UTF16PtrFromString(className)

	// Register TaskbarCreated message to handle Explorer restarts
	// This is CRITICAL for reliability (Fixes "icon not appearing" after explorer crash)
	taskbarMsgStr, _ := syscall.UTF16PtrFromString("TaskbarCreated")
	retMsg, _, _ := procRegisterWindowMessage.Call(uintptr(unsafe.Pointer(taskbarMsgStr)))
	taskbarCreatedMsg := uint32(retMsg)

	// Shared icon data for re-use
	var nid NOTIFYICONDATA
	var hwnd syscall.Handle
	var hIcon syscall.Handle

	// Helper to add/restore icon
	addTrayIcon := func() {
		nid.cbSize = uint32(unsafe.Sizeof(nid))
		nid.hWnd = hwnd
		nid.uID = 100
		nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP
		nid.uCallbackMessage = WM_TRAY
		nid.hIcon = hIcon

		tipStr, _ := syscall.UTF16FromString("WinHTML Editor")
		copy(nid.szTip[:], tipStr)

		procShell_NotifyIconW.Call(NIM_ADD, uintptr(unsafe.Pointer(&nid)))
	}

	// Define WndProc callback
	wndProc := syscall.NewCallback(func(h syscall.Handle, msg uint32, wparam, lparam uintptr) uintptr {
		// Handle Taskbar Restoration
		if msg == taskbarCreatedMsg {
			addTrayIcon()
			return 0
		}

		switch msg {
		case WM_TRAY:
			switch lparam {
			case WM_LBUTTONUP, WM_LBUTTONDBLCLK:
				openDefaultBrowser(url)
			case WM_RBUTTONUP, WM_RBUTTONDBLCLK:
				// FIX: Menu Reliability Logic
				// 1. SetForegroundWindow (Must be called BEFORE TrackPopupMenu)
				// 2. TrackPopupMenu
				// 3. PostMessage(WM_NULL) (Must be called AFTER TrackPopupMenu to close menu on outside click)

				var pt POINT
				procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))

				// Essential for menu to receive focus
				procSetForegroundWindow.Call(uintptr(h))

				hMenu, _, _ := procCreatePopupMenu.Call()
				if hMenu == 0 {
					return 0
				}
				// FIX: Ensure menu is destroyed even if panic occurs or early return
				defer procDestroyMenu.Call(hMenu)

				openStr, _ := syscall.UTF16PtrFromString("Open Editor")
				procAppendMenuW.Call(hMenu, MF_STRING, 1, uintptr(unsafe.Pointer(openStr)))
				
				procAppendMenuW.Call(hMenu, MF_SEPARATOR, 0, 0)
				
				exitStr, _ := syscall.UTF16PtrFromString("Exit")
				procAppendMenuW.Call(hMenu, MF_STRING, 2, uintptr(unsafe.Pointer(exitStr)))

				// Blocking call to show menu
				res, _, _ := procTrackPopupMenu.Call(hMenu, TPM_RETURNCMD|TPM_RIGHTBUTTON, uintptr(pt.X), uintptr(pt.Y), 0, uintptr(h), 0)
				
				// Essential hack for menu to close properly when clicking outside (KB135788)
				procPostMessage.Call(uintptr(h), WM_NULL, 0, 0)

				if res == 1 {
					openDefaultBrowser(url)
				} else if res == 2 {
					procPostQuitMessage.Call(0)
				}
			}
		case WM_DESTROY:
			procPostQuitMessage.Call(0)
		default:
			ret, _, _ := procDefWindowProcW.Call(uintptr(h), uintptr(msg), wparam, lparam)
			return ret
		}
		return 0
	})
	
	// Get Module Handle
	hInstance, _, _ := procGetModuleHandleW.Call(0)

	// Load Icon
	const IDI_ICON1 = 1
	hIconRes, _, _ := procLoadIconW.Call(hInstance, uintptr(IDI_ICON1))
	hIcon = syscall.Handle(hIconRes)
	if hIcon == 0 {
		hIconRes, _, _ = procLoadIconW.Call(0, uintptr(IDI_APPLICATION))
		hIcon = syscall.Handle(hIconRes)
	}

	hCursor, _, _ := procLoadCursorW.Call(0, uintptr(IDC_ARROW))

	var wc WNDCLASSEX
	wc.cbSize = uint32(unsafe.Sizeof(wc))
	wc.lpfnWndProc = wndProc
	wc.hInstance = syscall.Handle(hInstance)
	wc.hIcon = syscall.Handle(hIcon)
	wc.hCursor = syscall.Handle(hCursor)
	wc.lpszClassName = classNamePtr

	procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))

	// Create Window (Hidden)
	hwndRes, _, _ := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(classNamePtr)),
		uintptr(unsafe.Pointer(classNamePtr)),
		0, 0, 0, 0, 0,
		0, 0, 0, 0,
	)
	hwnd = syscall.Handle(hwndRes)

	// Add Initial Icon
	addTrayIcon()

	// Message Loop
	var msg MSG
	for {
		ret, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if ret == 0 {
			break
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&msg)))
		procDispatchMessageW.Call(uintptr(unsafe.Pointer(&msg)))
	}

	procShell_NotifyIconW.Call(NIM_DELETE, uintptr(unsafe.Pointer(&nid)))
	unlockAll()
}

// --- Helpers ---

func inlineLocalImages(htmlContent string, htmlFilePath string) string {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[Recovery] Panic in inlineLocalImages: %v", r)
		}
	}()

	baseDir := filepath.Dir(htmlFilePath)
	imgTagRe := regexp.MustCompile(`(?i)<img\s+[^>]*>`)
	srcRe := regexp.MustCompile(`(?i)(\s|^)src\s*=\s*("([^"]*)"|'([^']*)')`)

	return imgTagRe.ReplaceAllStringFunc(htmlContent, func(imgTag string) string {
		match := srcRe.FindStringSubmatch(imgTag)
		if match == nil {
			return imgTag
		}

		srcContent := match[3]
		quoteChar := "\""
		if srcContent == "" {
			srcContent = match[4]
			quoteChar = "'"
		}

		if strings.HasPrefix(srcContent, "data:") ||
			strings.HasPrefix(srcContent, "http:") ||
			strings.HasPrefix(srcContent, "https:") ||
			strings.HasPrefix(srcContent, "//") {
			return imgTag
		}

		cleanPath := srcContent
		if idx := strings.IndexAny(cleanPath, "?#"); idx != -1 {
			cleanPath = cleanPath[:idx]
		}
		if unescaped, err := url.QueryUnescape(cleanPath); err == nil {
			cleanPath = unescaped
		}
		cleanPath = filepath.FromSlash(cleanPath)
		fullPath := filepath.Join(baseDir, cleanPath)

		data, err := os.ReadFile(fullPath)
		if err != nil {
			return imgTag
		}

		mimeType := http.DetectContentType(data)
		base64Data := base64.StdEncoding.EncodeToString(data)
		newDataURI := fmt.Sprintf("data:%s;base64,%s", mimeType, base64Data)

		newSrcAttr := fmt.Sprintf("%ssrc=%s%s%s", match[1], quoteChar, newDataURI, quoteChar)
		return strings.Replace(imgTag, match[0], newSrcAttr, 1)
	})
}

func generateID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func openDefaultBrowser(url string) {
	var err error
	switch runtime.GOOS {
	case "windows":
		err = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "linux":
		err = exec.Command("xdg-open", url).Start()
	case "darwin":
		err = exec.Command("open", url).Start()
	}
	if err != nil {
		log.Println("Error opening default browser:", err)
	}
}

func findBrowserPath() string {
	if runtime.GOOS != "windows" {
		return ""
	}

	edgePaths := []string{
		`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
		`C:\Program Files\Microsoft\Edge\Application\msedge.exe`,
	}
	for _, p := range edgePaths {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}

	chromePaths := []string{
		`C:\Program Files\Google\Chrome\Application\chrome.exe`,
		`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
		filepath.Join(os.Getenv("LOCALAPPDATA"), `Google\Chrome\Application\chrome.exe`),
	}
	for _, p := range chromePaths {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}

	return ""
}