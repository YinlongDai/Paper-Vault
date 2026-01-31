# 📚 Paper Vault
**This project is 100% vibe coded.**

Paper Vault is a lightweight research paper manager built with **Next.js (App Router)**, **Prisma**, and **SQLite**.

It allows you to search papers (arXiv + OpenAlex), save them locally, organize with labels, take Markdown notes, view PDFs inline, and optionally generate AI summaries.

---

## ✨ Features

  🔍 Search papers from arXiv and OpenAlex

  💾 Save papers locally
  
  🏷️ Add / remove labels

  📝 Markdown notes per paper

  📄 Inline PDF viewer

  🤖 Optional AI-generated paper summaries

  🗄️ Local SQLite database (zero **setup**)

---

## 📦 Installation

### 1️⃣ Clone the repository

    git clone https://github.com/your-username/paper-vault.git
    cd paper-vault

### 2️⃣ Install dependencies

    npm install

---

## 🔐 Environment Variables

This project uses two environment files:

  `.env` → used by Prisma
  ****
  `.env.local` → used by Next.js and API routes

### 3️⃣ Create env files from template

    cp .env.example .env
    cp .env.example .env.local

### 4️⃣ Edit `.env`

    DATABASE_URL="file:./dev.db"

This configures Prisma to use a local SQLite database.

### 5️⃣ Edit `.env.local` (optional, for AI summaries)

    GEMINI_API_KEY=your_api_key_here

If this is not set, the app will still work but AI summaries will be disabled.

---

## 🗄️ Database Setup (Prisma)

### 6️⃣ Generate Prisma client

    npx prisma generate

### 7️⃣ Run database migrations

    npx prisma migrate dev

This will:
- Create `dev.db`
- Apply all migrations
- Keep schema and database in sync

`dev.db` is local-only and should not be committed.

---

## ▶️ Run the App

### 8️⃣ Start the development server

    npm run dev

Open the app at:

    http://localhost:3000

---

## 🤖 AI Summary Workflow (Optional)

1. Save a **paper**
2. Backend downloads the PDF
3. PDF + prompt are sent to Gemini
4. Summary is stored in the database
5. Summary appears on the paper detail page

Notes:
- Summaries are generated once per paper
- Stored permanently
- Separate from user notes

---

## 🧠 Philosophy

Paper Vault is intentionally:
- Local-first
- Minimal
- Hackable
- No authentication
- No cloud lock-in
