# 🚀 Deployment Guide for GitHub Pages

## Step-by-Step Instructions

### 1. Initialize Git Repository (if not already done)

Open a terminal in your project directory and run:

```bash
cd c:/Users/Calcul/Downloads/Xplore_Research/refuges/test_gemini/refuge-explorer
git init
git add .
git commit -m "Initial commit: Refuge Explorer application"
```

### 2. Create a GitHub Repository

1. Go to [GitHub](https://github.com) and log in
2. Click the **"+"** icon in the top right → **"New repository"**
3. Fill in the details:
   - **Repository name**: `refuge-explorer` (or your preferred name)
   - **Description**: "Interactive mountain refuge explorer for the French Alps"
   - **Visibility**: Choose Public or Private
   - **DO NOT** initialize with README, .gitignore, or license (we already have these)
4. Click **"Create repository"**

### 3. Connect Your Local Repository to GitHub

GitHub will show you commands. Use these (replace `YOUR_USERNAME` with your GitHub username):

```bash
git remote add origin https://github.com/YOUR_USERNAME/refuge-explorer.git
git branch -M main
git push -u origin main
```

### 4. Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings** (top menu)
3. Click **Pages** (left sidebar)
4. Under "Build and deployment":
   - **Source**: Select "GitHub Actions"
5. That's it! The workflow will automatically deploy on every push to `main`

### 5. Wait for Deployment

1. Go to the **Actions** tab in your repository
2. You should see a workflow running called "Deploy to GitHub Pages"
3. Wait for it to complete (usually 1-2 minutes)
4. Once complete, your site will be live at:
   ```
   https://YOUR_USERNAME.github.io/refuge-explorer/
   ```

## 🔄 Future Updates

Whenever you want to update your site:

```bash
git add .
git commit -m "Description of your changes"
git push
```

The site will automatically rebuild and deploy!

## 🛠️ Local Development

To work on the project locally:

```bash
# Install dependencies (first time only)
npm install

# Start development server
npm run dev

# Build for production (to test)
npm run build

# Preview production build
npm run preview
```

## 📝 Important Notes

### Large Files
Your `public/refuges_enriched.json` and `public/massifs.json` files are quite large. GitHub has a 100MB file size limit. If you encounter issues:

1. Check file sizes:
   ```bash
   ls -lh public/*.json
   ```

2. If files are too large, consider:
   - Using Git LFS (Large File Storage)
   - Hosting the JSON files elsewhere (e.g., GitHub Releases, CDN)
   - Compressing the files

### Custom Domain (Optional)

If you want to use a custom domain:

1. In your repository Settings → Pages
2. Add your custom domain under "Custom domain"
3. Follow GitHub's instructions for DNS configuration

### Environment Variables

If you need to add environment variables:

1. Create a `.env` file locally (already in .gitignore)
2. For GitHub Actions, add secrets in Settings → Secrets and variables → Actions

## 🐛 Troubleshooting

### Deployment fails
- Check the Actions tab for error messages
- Ensure all dependencies are in `package.json`
- Verify the build works locally with `npm run build`

### Site shows 404
- Make sure GitHub Pages is enabled
- Check that the workflow completed successfully
- Verify the base path in `vite.config.js` matches your repo name

### Assets not loading
- Check browser console for errors
- Verify the base path is correct
- Make sure all files are committed and pushed

## 📧 Need Help?

If you encounter issues:
1. Check the GitHub Actions logs
2. Review the [GitHub Pages documentation](https://docs.github.com/en/pages)
3. Open an issue in your repository

---

**Happy deploying! 🎉**
