# ZenTeams

## Deploying to Vercel

Vite **inlines** environment variables whose names start with `VITE_` **when the app is built**. If those variables are missing at build time, the production bundle has an empty API key and Firebase throws **`auth/invalid-api-key`** (blank white screen in the console).

### 1. Add environment variables in Vercel

In the Vercel dashboard: **Project → Settings → Environment Variables**.

Add the same keys as in `.env.example`, using values from **Firebase Console → Project settings → Your apps → Web app** (`firebaseConfig`):

| Name | Notes |
|------|--------|
| `VITE_FIREBASE_API_KEY` | Required |
| `VITE_FIREBASE_AUTH_DOMAIN` | Usually `your-project-id.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | Required |
| `VITE_FIREBASE_STORAGE_BUCKET` | Required |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Required |
| `VITE_FIREBASE_APP_ID` | Required |
| `VITE_FIREBASE_MEASUREMENT_ID` | Optional (Analytics) |

- Enable these for **Production** (and **Preview** if you use preview deployments).
- Do **not** set `VITE_USE_EMULATORS` on Vercel (leave unset or `false`).

### 2. Redeploy

After saving variables, trigger a **new deployment** (Redeploy from the Deployments tab, or push a commit). Old builds will not pick up new env vars.

### 3. Allow your domain in Firebase

**Firebase Console → Authentication → Settings → Authorized domains** → add:

- `zenteams.vercel.app`
- Your custom domain, if you use one

Without this, sign-in can fail even with a valid API key.

### Local development

Copy `.env.example` to `.env`, fill in values, then `npm run dev`.
