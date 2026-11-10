# Supabase Auth — email confirmation URLs

Signup uses Supabase Auth with a real email. The confirmation link uses
`emailRedirectTo` from the app:

| Environment | Origin | Callback |
| --- | --- | --- |
| Local | `http://localhost:3000` | `http://localhost:3000/auth/callback` |
| Production | `https://seethroughus.com` | `https://seethroughus.com/auth/callback` |

Override with `NEXT_PUBLIC_APP_URL` when needed.

## Dashboard settings

In Supabase → Authentication → URL Configuration:

1. **Site URL** — production: `https://seethroughus.com`
2. **Redirect URLs** — allow both:
   - `http://localhost:3000/auth/callback`
   - `https://seethroughus.com/auth/callback`

Enable **Confirm email** under Authentication → Providers → Email so new
users must click the link before logging in.
