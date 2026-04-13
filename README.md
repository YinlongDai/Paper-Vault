# 📚 My Paper Vault

**A lightweight, local-first research paper manager.**

My Paper Vault allows you to search papers from **arXiv** and **OpenAlex**, save them to a local database, organize them with labels, take Markdown notes, and view PDFs—all without needing a cloud account or complex authentication.

---

## ✨ Features

- 🔍 **Unified Search**: Search across arXiv and OpenAlex simultaneously.
- 💾 **Local Storage**: Save paper metadata, abstracts, and your custom notes to a local SQLite database.
- 🏷️ **Organization**: Create, assign, and filter by custom labels.
- 📝 **Markdown Notes**: Write and render formatted notes for every paper.
- 📄 **Integrated PDF Viewer**: View papers directly in your browser using a proxied viewer that bypasses CORS restrictions.
- 🤖 **AI Summaries**: (Optional) Generate detailed paper summaries using the Gemini API.
- 🏠 **Privacy-Focused**: No authentication required; all data stays on your machine in a local `dev.db` file.

---

## 🚀 Getting Started

Follow these steps to get My Paper Vault running on your local machine.

### 1️⃣ Prerequisites

Ensure you have the following installed:
- **Node.js** (v18 or higher recommended)
- **npm** (comes with Node.js)

### 2️⃣ Installation

Clone the repository and install the dependencies:

```bash
# Clone the repository
git clone https://github.com/YinlongDai/Paper-Vault.git
cd Paper-Vault

# Install all required packages
npm install
```

### 3️⃣ Environment Configuration

The application uses a local SQLite database. You need to set up your environment variables:

```bash
# Copy the example environment file
cp .env.example .env
```

Open the `.env` file in your text editor and ensure it contains:
```env
DATABASE_URL="file:./dev.db"

# Optional: Add your Gemini API Key for AI Summaries
# GEMINI_API_KEY=your_actual_key_here
```
*Note: If you don't provide a `GEMINI_API_KEY`, the "Generate Summary" feature will be disabled, but all other functions will work perfectly.*

### 4️⃣ Database Initialization

Initialize your local database and generate the Prisma client:

```bash
# Generate the Prisma client
npx prisma generate

# Apply migrations to create the local database file (dev.db)
npx prisma migrate dev --name init
```

### 5️⃣ Start the Local Server

Now you are ready to launch the application:

```bash
npm run dev
```

### 6️⃣ Open in Your Browser

Once the server starts, you will see a message in your terminal. Open your favorite web browser and navigate to:

👉 **[http://localhost:3000](http://localhost:3000)**

---

## 🛠️ How to Use

1. **Search**: Enter a topic (e.g., "diffusion models") in the search bar on the home page.
2. **Save**: Click the ⭐ icon on any paper to save it to your vault. You can pick existing labels or create new ones during this step.
3. **View Saved**: Click the **Saved** link in the top right to see your library.
4. **Manage**: Click on a paper title in your saved list to:
   - Read the full abstract.
   - Edit your personal Markdown notes.
   - View the PDF inline.
   - Generate an AI summary (if Gemini API key is configured).
   - Add or remove labels.

---

## 🧠 Technical Stack

- **Framework**: [Next.js 15+](https://nextjs.org/) (App Router)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Database**: [SQLite](https://www.sqlite.org/) via [Prisma ORM](https://www.prisma.io/)
- **Styling**: Vanilla CSS (Modern, responsive layout)
- **PDF Rendering**: [pdfjs-dist](https://github.com/mozilla/pdf.js)

---

## 🔒 Privacy & Data

- **No Auth**: This version of Paper Vault has no login system. Anyone with access to your local machine can view the data.
- **Local Database**: All your saved papers and notes are stored in `prisma/dev.db`. **Back up this file** if you want to keep your data safe!
- **No Cloud Tracking**: Your search queries go directly to arXiv/OpenAlex APIs. Summaries go to Google Gemini API (if enabled). No other data is sent to external servers.
