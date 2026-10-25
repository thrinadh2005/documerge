# DocuMerge Studio — 100% Offline Document Merger PWA

A high-performance, privacy-first Progressive Web Application (PWA) designed to combine, organize, rotate, and merge **PDF documents, Word documents (.docx), PowerPoint presentations (.pptx), and images** completely offline directly in your browser.

Designed with the **Floral White** (`#FAF7EE`) & **Black Olive** (`#31372B`) luxury editorial palette, optimized for touch on mobile phones and fluid drag-and-drop on desktop.

**Created & Engineered by**: **Adabala Venkata Thrinadh**

---

## ✨ Key Features

- **⚡ 100% Client-Side & Air-Gapped Privacy**: Files are processed entirely in browser memory using WebAssembly & Web Workers (`pdf-lib` + `pdfjs-dist` + `mammoth` + `jszip` + `html2canvas`). Your files are never uploaded to any server.
- **📄 Complete Document Ecosystem**:
  - **PDF Documents** (`.pdf`)
  - **Word Documents** (`.docx` — converted to paginated vector-like pages offline)
  - **PowerPoint Presentations** (`.pptx`, `.ppt` — slide extraction & widescreen formatting)
  - **Images** (`.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.bmp` — auto-converted with aspect ratio preservation)
- **📱 Phone & Desktop Responsive**:
  - **On Mobile**: Touch-optimized 44px+ tap targets, up/down arrows for easy reordering, sticky bottom merge bar, and Web Share API support.
  - **On Desktop**: Drag-and-drop file upload, card reordering, and visual page thumbnail grid.
- **📑 Dual Organization Modes**:
  - **Document View**: Reorder documents, specify custom page ranges (e.g., `1-3, 5` or `all`), rotate whole documents, duplicate, or remove.
  - **Visual Page Grid**: View real-time rendered page thumbnails, drag to sequence pages across documents, rotate individual pages by 90°, or omit unwanted pages.
- **🔢 Pro Merging Tools**:
  - **Automatic Page Numbering**: Adds clean, centered `"Page X of Y"` footers.
  - **Diagonal Watermarks**: Custom angled watermark text (e.g. `CONFIDENTIAL`, `DRAFT`) with soft opacity.
  - **Theme Toggle**: One-click switch between **Black Olive Dark** and **Floral White Light** modes with 100% sharp text visibility in both themes.
- **📲 Progressive Web App (PWA)**:
  - Service Worker cache-first offline shell (`sw.js`).
  - Web App Manifest (`manifest.webmanifest`) with high-resolution vector and PNG icons.
  - One-click **Install App** button for Desktop (Chrome/Edge) and Mobile (Android/iOS Add to Home Screen).

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- npm

### 1. Development Mode
Run the local Vite dev server with Hot Module Replacement:
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

### 2. Build for Production
To generate the static offline production bundle:
```bash
npm run build
```
The output will be created in the `dist/` directory, ready to be hosted on any static hosting platform.

---

## 🌐 Deployment Guide

### Option 1: GitHub Pages (Automated CI/CD Workflow Included)
An automated workflow is provided at `.github/workflows/deploy.yml`.
1. Push your project to GitHub:
   ```bash
   git init
   git add .
   git commit -m "DocuMerge Studio by Adabala Venkata Thrinadh"
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```
2. In your GitHub repository, navigate to **Settings** → **Pages** → choose **GitHub Actions** as the source.
3. Your PWA will build and deploy automatically with free HTTPS!

### Option 2: Vercel (1-Click Deployment)
A `vercel.json` file is pre-configured.
- Run `npx vercel` in this folder, or connect your GitHub repository at [vercel.com](https://vercel.com).

### Option 3: Netlify (1-Click Deployment)
A `netlify.toml` file is pre-configured.
- Run `npx netlify deploy --prod --dir=dist` or connect your GitHub repo at [netlify.com](https://netlify.com).

---

## 👨‍💻 Author Identity

- **Developer**: Adabala Venkata Thrinadh
- **Email**: thrinadh2005@gmail.com
- **Application**: DocuMerge Studio
- **License**: MIT
