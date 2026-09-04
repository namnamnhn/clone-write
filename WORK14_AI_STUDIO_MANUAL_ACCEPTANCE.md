# WORK14 Google AI Studio manual acceptance

These checks require a real Google AI Studio hosted preview and a legitimate
Gemini credential. They are not part of the automated test result.

1. Import or update branch `work14-ai-studio-deployment` in Google AI Studio Build.
2. Configure the server-side `GEMINI_API_KEY` secret and open the app preview.
3. Confirm navigation and Story Studio render.
4. Run **Kiểm tra kết nối** and confirm the selected Gemini model responds.
5. Import `WORK14_AI_STUDIO_SMOKE_SETUP.txt` from this repository.
6. Confirm Setup Compiler reaches Setup Review without a `ProxyUnaryCall` HTTP 400.
7. Review the setup and explicitly create the small C0 project.
8. Run C1 through Planner, Writer, Validator, State Extractor, and Canon Review.
9. Leave C1 approved-not-canon; do not press **Make Canon** unless testing persistence intentionally.
10. During a separate model attempt, press **Stop** and confirm the saved Canon/checkpoint does not advance.
11. Reload the preview and confirm the same browser/workspace restores its locally persisted project.
12. Re-enter personal API keys after reload if used; they must not persist across the session boundary.
13. Open legacy **Sáng Tác**, confirm it behaves independently, then return to Story Studio.
14. On localhost, set `GEMINI_API_KEY` in `.env.local`, run `npm run dev`, and compile the same smoke TXT successfully through the existing direct SDK transport.

Do not paste API keys into source files, browser logs, screenshots, or bug reports.
