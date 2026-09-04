<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/a66e8c47-2880-435e-a1da-2674238e0b3d

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

Local Vite development keeps the existing direct-browser Gemini transport. In a
Google AI Studio server runtime, `GEMINI_API_KEY` remains server-side and the
client uses the same-origin Node bridge automatically. Set
`GEMINI_TRANSPORT_MODE=server` or `direct` on the server to override transport
selection explicitly. A production build can be served with `npm run start`
after `npm run build`.

The server bridge does not persist or log prompts or keys. Optional personal
keys continue to live only in browser-session memory and are sent to the app's
same-origin bridge for the single request that selected that key.

See [WORK14_AI_STUDIO_MANUAL_ACCEPTANCE.md](./WORK14_AI_STUDIO_MANUAL_ACCEPTANCE.md)
for the hosted and localhost verification checklist.
