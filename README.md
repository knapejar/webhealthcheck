# Web Health Check

A minimalistic domain health check system with Slack integration built with Node.js.

## Features

- 🌐 Monitor multiple websites simultaneously
- ⚡ Configurable check intervals (default: every minute)
- 📊 Real-time web dashboard showing status and metrics
- 🔔 Slack notifications for errors and recovery
- 🐳 Docker support for easy deployment
- 🧪 Comprehensive test coverage

## Health Check Criteria

The system verifies that each monitored website:
- Returns HTTP status 200
- Responds within 10 seconds (configurable via TIMEOUT_SECONDS)
- Does not contain "A PHP Error was encountered" in the page content

## Notification Logic

- **Immediate notification**: When an error is first encountered
- **Continuous error alert**: After 5 consecutive failed checks (5 minutes)
- **Recovery notification**: After 10 consecutive successful checks

## Installation

### Option 1: Direct Node.js

1. Clone the repository:
```bash
git clone https://github.com/knapejar/webhealthcheck.git
cd webhealthcheck
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables (see Configuration section below)

4. Start the application:
```bash
npm start
```

### Option 2: Docker

1. Clone and build:
```bash
git clone https://github.com/knapejar/webhealthcheck.git
cd webhealthcheck
docker build -t webhealthcheck .
```

2. Run with environment variables:
```bash
docker run -d \
  -p 3000:3000 \
  -e DOMAINS="https://example.com;https://google.com" \
  -e SLACK_WEBHOOK_URL="https://hooks.slack.com/services/YOUR/WEBHOOK/URL" \
  --name webhealthcheck \
  webhealthcheck
```

## Configuration

Create a `.env` file or set environment variables:

```bash
# Required: Domains to monitor (semicolon-separated)
DOMAINS=https://example.com;https://google.com;https://github.com

# Required: Slack webhook URL for notifications
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Optional: Server port (default: 3000)
PORT=3000

# Optional: Check interval in minutes (default: 1)
CHECK_INTERVAL_MINUTES=1

# Optional: Response timeout in seconds (default: 10)
TIMEOUT_SECONDS=10
```

## Slack Integration Setup

1. **Create a Slack App**:
   - Go to https://api.slack.com/apps
   - Click "Create New App" → "From scratch"
   - Name your app (e.g., "Web Health Check") and select your workspace

2. **Enable Incoming Webhooks**:
   - In your app settings, go to "Incoming Webhooks"
   - Toggle "Activate Incoming Webhooks" to On
   - Click "Add New Webhook to Workspace"
   - Choose the channel where you want notifications
   - Copy the webhook URL

3. **Configure the Application**:
   - Set the `SLACK_WEBHOOK_URL` environment variable to your webhook URL
   - Restart the application

## Web Dashboard

Access the dashboard at `http://localhost:3000` (or your configured port).

The dashboard shows:
- Current configuration (domains, check interval, Slack status)
- Next scheduled check time
- Status of each monitored domain with details:
  - Current health status
  - Last check time
  - Response time
  - Consecutive error/success counts
  - Last error message (if any)
  - **Click on any domain card to view 24-hour availability history**

The page auto-refreshes every 30 seconds.

### History Pages

Click on any domain card to view detailed availability history:
- 24-hour grid visualization showing minute-by-minute availability
- Green squares indicate healthy responses
- Red squares indicate unhealthy responses  
- Gray squares indicate no data available
- Responsive design that works on desktop and mobile
- Statistics showing uptime percentage, minutes down, and total checks

## API

### GET `/api/status`

Returns JSON status of all monitored domains:

```json
{
  "nextCheckTime": "2025-01-20T10:15:00.000Z",
  "status": {
    "https://example.com": {
      "status": "healthy",
      "lastCheck": "2025-01-20T10:14:30.000Z",
      "lastError": null,
      "consecutiveErrors": 0,
      "consecutiveSuccesses": 5,
      "responseTime": 234
    }
  }
}
```

## Testing

Run the test suite to validate the health check detection:

```bash
npm test
```

The tests verify:
- Healthy domain detection
- PHP error detection in page content
- Slow response time detection (>5 seconds)
- HTTP error status detection
- Slack notification logic for errors and recovery

## Docker Compose Example

```yaml
version: '3.8'
services:
  webhealthcheck:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DOMAINS=https://example.com;https://google.com
      - SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
      - CHECK_INTERVAL_MINUTES=1
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "const http = require('http'); http.get('http://localhost:3000/api/status', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"]
      interval: 30s
      timeout: 10s
      retries: 3
```

## Monitoring

The application includes built-in health checks when running in Docker. You can also monitor the `/api/status` endpoint for integration with external monitoring systems.

## License

MIT License - see [LICENSE](LICENSE) file for details.
