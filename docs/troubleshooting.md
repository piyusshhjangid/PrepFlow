# Troubleshooting

| Symptom                                                        | Likely cause and fix                                                                                            |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| API exits at startup listing invalid environment variables     | Copy `apps/api/.env.example` to `apps/api/.env` and fill `DATABASE_URL` and `CLIENT_URL`.                       |
| `npm install` fails in `prisma generate` with 403/ECONNREFUSED | The machine cannot reach `binaries.prisma.sh`. Allow that host, or install on a network that can.               |
| Web shows "can't reach the server" / `ECONNREFUSED` for `/api` | API is not running (`npm run dev:api`), or in production `VITE_API_BASE_URL`/proxy is wrong.                    |
| Browser blocks requests (CORS)                                 | Add the web origin to the API's `CLIENT_URL` (exact scheme, host and port).                                     |
| `npm run db:check` reports credentials rejected                | Fix the user/password in `DATABASE_URL` (URL-encode special characters).                                        |
| Integration tests refuse to run                                | `TEST_DATABASE_URL` must differ from `DATABASE_URL` and contain "test". They clear tables.                      |
| Analysis fails with an AI error code                           | Provider unreachable, bad key (`AI_AUTH_FAILED`), unknown model (`AI_MODEL_NOT_FOUND`). Run `npm run ai:smoke`. |
| Analysis says no topics found                                  | Material may be scanned (no text layer), too short, or evidence did not match. Try pasted text.                 |
| Analysis marked interrupted                                    | The API restarted mid-run. Start it again.                                                                      |
| 429 "doing that a lot"                                         | Per-IP rate limit; wait for the window to pass or adjust `ANALYSIS_RATE_*`.                                     |
