# Deploying Chalkline to Render

Chalkline runs as **one Docker web service**. The same Node process serves the built client, `GET /healthz` and the Socket.IO WebSocket on `PORT`.

Steps checked against Render's documentation on **2026-11-11**: Blueprint spec, Blueprints overview, web services, Docker, environment variables, health checks, deploys, rollbacks, free instances, WebSockets, scaling, custom domains, logging, and troubleshooting deploys. Render changes its dashboard from time to time. If a button name differs, the linked page has the current wording.

## 1. Prerequisites

- **A GitHub repository** with this project pushed to it, including `Dockerfile`, `.dockerignore` and `render.yaml` at the root. GitLab and Bitbucket work the same way.
- **A Render account** (https://dashboard.render.com) with your Git provider connected. Render asks for this the first time you pick a repo.
- Optional: a domain you control, for step 8.

To check the image locally before you push (Docker installed):

```bash
docker build -t chalkline .
docker run --rm -p 3000:3000 chalkline
# then open http://localhost:3000 and http://localhost:3000/healthz
```

## 2. Deploy

### Option A: Blueprint (`render.yaml`, recommended)

`render.yaml` describes one service: `type: web`, `runtime: docker`, `plan: free`, `region: oregon`, `healthCheckPath: /healthz`, `numInstances: 1`, and auto-deploy on every commit.

1. Push the repo, including `render.yaml`, to GitHub.
2. In the Render Dashboard, click **New > Blueprint**.
3. Click **Connect** next to your repository.
4. Enter a Blueprint name and choose the branch (`main`). Leave **Blueprint Path** as `render.yaml`.
5. Review the planned changes: one web service named `chalkline`. Click **Deploy Blueprint**.
6. Render builds the Dockerfile and starts the service. Follow it under the service's **Events** and **Logs** pages.

The service URL is `https://<service-name>.onrender.com`. If the name `chalkline` is taken, Render adds a suffix, so copy the exact URL from the service page. To change the plan or region before the first deploy, edit `plan` (`free`, `0.5c-512mb`, `1c-2g`, ...) or `region` (`oregon`, `ohio`, `virginia`, `frankfurt`, `singapore`) in `render.yaml`. You can't change the region after the service exists.

Later pushes that change `render.yaml` sync the Blueprint automatically. Settings you change in the Dashboard can be overwritten by the next sync if they conflict with the file.

### Option B: Manual web service

1. In the Render Dashboard, click **New > Web Service**.
2. Choose **Git Provider** and select the repo and branch (`main`).
3. Fill in the form:
   - **Name:** `chalkline` (or anything).
   - **Region:** the one closest to your players. It can't be changed later.
   - **Language:** **Docker**. Render then uses `./Dockerfile` from the repo root. Leave build and start commands empty, because the Dockerfile's `CMD` starts the server.
   - **Instance type:** **Free** to try it out, or a paid type (see section 6).
4. Open **Advanced**:
   - **Health Check Path:** `/healthz`
   - **Environment Variables:** add `NODE_ENV=production`. `ALLOWED_ORIGIN` is optional (see section 3).
   - Make sure auto-deploy is **On Commit** if you want pushes to deploy.
5. Click **Create Web Service**.

## 3. Environment variables

| Variable | What it does | Value on Render |
|---|---|---|
| `PORT` | Port the server binds, on `0.0.0.0`. | **Don't set it.** Render sets `PORT` itself (default `10000`) and routes public HTTPS and WebSocket traffic to it. The server reads `process.env.PORT` and only falls back to `3000` when it's missing (local runs). |
| `ALLOWED_ORIGIN` | Comma-separated list of origins (scheme + host, no trailing slash) allowed to open a game socket. Others are refused at the handshake, for both polling and WebSocket upgrades. | **Leave unset** on the `onrender.com` URL alone: the server then allows only `RENDER_EXTERNAL_URL`, which Render sets to your `https://<name>.onrender.com` URL. **Set it** once you add a custom domain, listing every origin players use, e.g. `https://pool.example.com,https://chalkline.onrender.com`. |
| `NODE_ENV` | Standard Node flag. | `production` (set in `render.yaml`). |
| `RENDER_EXTERNAL_URL` | Set by Render; read by the server as the default allowed origin. | Nothing to do. |

Locally, with `ALLOWED_ORIGIN` and `RENDER_EXTERNAL_URL` both unset, any origin is allowed. See `.env.example`.

To edit variables later, open the service's **Environment** page, change them, and save. The new values take effect on the next deploy. If Render doesn't start one, use **Manual Deploy > Deploy latest commit**.

## 4. Health check and confirming the deploy

- The health check path is `/healthz` (set by `render.yaml`, or by hand under **Settings > Health Checks > Edit**). It returns `200 ok` once the server is listening.
- Render counts any 2xx or 3xx response within 5 seconds as healthy. During a deploy, traffic moves to the new instance only once its checks pass. If they don't pass within 15 minutes, the deploy is cancelled and the old instance keeps serving. At runtime, 15 s of failures stops traffic to the instance and 60 s restarts it.

Confirm it's live:

1. Wait for the deploy to show **Live** on the service page.
2. Open `https://<name>.onrender.com/healthz`. You should see `ok`.
3. Open `https://<name>.onrender.com` in **two browser windows** (or a normal and a private window).
4. In the first, enter a name and click **Create** (1v1). Click **Copy invite link**.
5. Paste the link (`/r/CODE`) into the second window, enter a name and click **Join**, then **Ready**.
6. In the first window, click **Start** and play a few shots in each window. Both tables must match after every shot.

## 5. WebSockets on Render

Render web services accept public WebSocket connections on the same port as HTTP. There's nothing to enable. Render sets no maximum WebSocket duration, but connections close whenever the instance is replaced: on a deploy, a restart, platform maintenance or a free-tier spin-down. Chalkline's client reconnects by itself and resumes its seat with the token in `sessionStorage`.

Connections must use `wss://` (the client uses the page's own origin, so on `https://` this is automatic). Plain `ws://` gets a redirect to TLS that most clients don't follow.

If sockets fail:

- **Browser console shows `400` or `403` on `/socket.io/?EIO=4...`:** the origin was refused. The page's origin must equal `RENDER_EXTERNAL_URL` or be listed in `ALLOWED_ORIGIN` exactly: scheme, host, no path, no trailing slash.
- **The Network tab shows only `transport=polling` requests and no `transport=websocket` 101 upgrade:** something between the browser and Render is blocking WebSockets, such as a corporate proxy, an extension, or a CDN or proxy in front of your custom domain without WebSocket support. The game still works over long-polling, just with more latency. Try another network to confirm.
- **The connection drops every so often:** check the **Events** page for deploys, restarts or spin-downs at those times.

## 6. Free tier caveats, and what a paid instance changes

On the **Free** instance type:

- The service **spins down after 15 minutes without inbound traffic**. Traffic means HTTP requests and WebSocket messages, and an open game sends messages, so an active game keeps it awake. The next visit wakes it in **about a minute**, and the browser shows a loading page meanwhile.
- **Rooms live only in server memory.** A spin-down, a restart (Render may restart free services at any time) or any redeploy **ends every live match and lobby**. Players are sent back to the menu with "That game has ended."
- Free services share **750 instance hours per workspace per month**. When they run out, free services are suspended until the next month.
- One instance only, no shell access, ephemeral filesystem. Chalkline needs neither disk nor shell.

Any **paid instance type** doesn't spin down and isn't subject to the free monthly-hours limit or arbitrary free-tier restarts, so rooms survive until the next deploy or restart. **Deploys still end live matches**, because state is in memory: Render's zero-downtime deploy starts a new instance with no rooms, moves traffic to it, and sends `SIGTERM` to the old one, which closes its sockets. Deploy when nobody is playing, or turn auto-deploy off and deploy by hand. Paid services can also scale, but read section 7 first.

## 7. Run exactly one instance

Keep `numInstances: 1` and leave autoscaling off.

Every room exists only in the memory of the process that created it. Render's WebSocket docs say its load balancer assigns connections to instances randomly, and that reconnects should be expected to land on a different instance. With two or more instances:

- A player whose socket lands on instance B can't join a room created on instance A ("no such room").
- A reconnect after a deploy or network drop can land on another instance and lose the seat.
- Socket.IO's HTTP long-polling fallback needs every request of a session to reach the same instance. Random assignment breaks that, and the wrong instance answers "Session ID unknown."

Scaling out would need shared room state and the Socket.IO Redis adapter (for example with Render Key Value), plus moving `RoomManager` state out of process. That's out of scope for v1.

## 8. Custom domain

1. Open the service's **Settings** page and go to **Custom Domains > + Add Custom Domain**. Enter the domain (e.g. `pool.example.com`) and save. Adding `www.example.com` also adds the root as a redirect, and the other way round.
2. At your DNS provider, remove any `AAAA` records for that name, since Render uses IPv4. Add the record Render shows: a `CNAME` from your subdomain to `<name>.onrender.com`. For a root domain, use the record type Render's dialog and your provider's guide give.
3. Click **Verify** in Render. If it fails, DNS is probably still propagating, so wait and retry. Render then issues and renews a TLS certificate and redirects HTTP to HTTPS. A brief 502 right after verification is normal while routing updates.
4. **Update `ALLOWED_ORIGIN`** on the **Environment** page to every origin players will use, e.g. `https://pool.example.com,https://<name>.onrender.com`. Save and redeploy. Until you do, sockets from the new domain are refused, because the default allows only the `onrender.com` URL.
5. Optional: once the custom domain works, you can disable the `onrender.com` subdomain (**Render Subdomain** toggle). Then drop it from `ALLOWED_ORIGIN`.

Whenever the domain changes again, update `ALLOWED_ORIGIN` the same way.

## 9. Redeploys, logs and rollback

- **Redeploy:** with auto-deploy **On Commit**, every push to `main` deploys. To deploy by hand, use **Manual Deploy** on the service page: **Deploy latest commit**, **Clear build cache & deploy** (use this if a build behaves oddly), or deploy a specific commit (which turns auto-deploy off). Put `[skip render]` in a commit message to skip one auto-deploy. **Each deploy ends live matches.**
- **Logs:** the service's **Logs** page has search, level and instance filters, a time range (default last hour) and **Live tail**. Build output for each deploy is on the **Deploys** page. Chalkline logs `listening on <port>` at start, `shutting down` on `SIGTERM`, and any refused bot move. Retention is 7 days on the Hobby workspace plan, 14 on Pro and 30 on Scale and Enterprise.
- **Rollback:** on the **Deploys** page, find an earlier successful deploy, click **Rollback**, then **Rollback to this deploy**. Render redeploys that build with its settings and environment variables. **A Dashboard rollback turns auto-deploy off.** Turn it back on under **Settings** once you've pushed a fix. How far back you can go depends on your workspace plan.

## 10. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| **Build fails at `npm ci`** | `package-lock.json` is missing or out of date. Run `npm install` locally, commit the lockfile and push. Native packages (`@rolldown/binding-linux-*-musl`, `lightningcss-linux-*-musl`, `@esbuild/linux-*`) must be in the lockfile. A fresh `npm install` with npm 10+ records them for every platform. |
| **Build fails at `npm run build`** | Run `npm run build` locally first. Check file-name casing, because Render builds on Linux where `Render.ts` and `render.ts` differ. Try **Clear build cache & deploy**. |
| **Build out of memory or timed out** | A free build is small. Retry, or move to a larger instance type. |
| **Deploy fails with "Port scan timeout reached"** | Nothing listened on `PORT` on `0.0.0.0`. Make sure you didn't set `PORT` to something odd and didn't override the Docker command. The logs should show `listening on 10000`. |
| **Deploy fails with "HTTP health check failed"** | `/healthz` must return 2xx within 5 s. Check that the health check path is exactly `/healthz`. If the log shows the server crashed on start, fix that first. |
| **502 Bad Gateway** | The first deploy hasn't succeeded yet, the instance is failing health checks, or a new custom domain's DNS is still propagating (minutes, occasionally up to an hour). |
| **Page loads but the menu says nothing happens, or console shows socket `400`/`403`** | Origin rejected. See section 5 and fix `ALLOWED_ORIGIN`, then redeploy. |
| **Sockets stuck on polling** (`transport=polling` only, laggy shots) | WebSockets are blocked on the client's path (proxy, VPN, extension, or a proxy or CDN in front of the custom domain). Try another network. If you put Cloudflare or similar in front, enable its WebSocket support. |
| **"That game has ended" after a while** | The instance restarted, redeployed or (free tier) spun down, and rooms live in memory. See section 6. |
| **"No such room" for a code that was just created** | More than one instance is running. Set the instance count back to 1 (section 7). |
| **The first page load takes about a minute** | Free-tier spin-up after 15 idle minutes. Expected. |
