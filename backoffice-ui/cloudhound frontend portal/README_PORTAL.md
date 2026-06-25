# CloudHound Frontend Portal

A standalone React + TypeScript + Vite security operations portal for viewing CloudHound scan results and managing IAM topology graphs.

## Project Overview

The CloudHound Frontend Portal is a dedicated web application that allows security engineers to:
- View the latest CloudHound security scan results for their AWS accounts
- Explore IAM topology and entity relationships via Neo4j graph visualization
- Manage tool user access permissions (admin only)

## Technology Stack

- **Frontend Framework**: React 19 with TypeScript
- **Build Tool**: Vite 8
- **Styling**: Tailwind CSS with @tailwindcss/postcss
- **Icons**: lucide-react
- **UI Primitives**: Radix UI (react-tabs, react-dialog, etc.)
- **HTTP Client**: Fetch API (native)

## Project Structure

```
src/
├── api/
│   └── cloudhound-api.ts          # CloudHound API client with typed endpoints
├── components/
│   └── CloudHoundPortal.tsx       # Main portal component (3 tabs)
├── App.tsx                         # Root React component
├── main.tsx                        # Vite entry point
├── index.css                       # Tailwind CSS directives
└── App.css                         # Additional app styles
```

## Features

### 1. Scan Results Tab
- View latest CloudHound scan status (queued/running/success/failed)
- Progress tracking with visual progress bar
- Severity-based statistics (Critical, High, Medium, Low, Info)
- Finding list with filtering by severity
- Finding details including entity information and risk level

### 2. Graph Explorer Tab
- Neo4j graph visualization queries:
  - IAM Topology: View complete IAM entity relationships
  - High Value Targets (HVT): Focus on high-risk entities
  - External Trust Relationships: Identify external account access
- Graph metrics display (total nodes, edges, high-risk entities)
- Node list with risk level indicators
- Query selector for dynamic graph switching

### 3. Access Management Tab
- Admin form to add tool users to the account
- Email and Cognito ID input validation
- Current tool users list with active/inactive status
- Success/error notifications for user operations

### 4. Account Selection
- AWS account dropdown selector
- Loads data based on selected account context
- Supports multi-account environments

## Configuration

### Environment Variables

Create `.env.local` file in project root:

```env
# Backend API configuration
VITE_API_BASE_URL=http://localhost:8000/api
```

For production, set this to your backend URL:
```env
VITE_API_BASE_URL=https://api.cloudfruition.com/api
```

### Authentication

The portal expects authentication tokens to be available in `localStorage` under the key `authToken`. The API client will automatically include this token in requests:

```typescript
// Example: Store auth token after login
localStorage.setItem('authToken', 'your-jwt-token');
```

## API Integration

The portal connects to the following CloudFruition backend endpoints:

### 1. Latest Scan Result
```
GET /cloudhound/portal-latest-result/?selected_aws_account_id=<account_id>
```

### 2. Graph Data
```
GET /cloudhound/portal-graph/?selected_aws_account_id=<account_id>&query_key=<query_type>
```

Query types: `iam_topology`, `hvt_entities`, `external_trusts`

### 3. Tool Users (List)
```
GET /cloudhound/portal-tool-users/?selected_aws_account_id=<account_id>
```

### 4. Tool Users (Add)
```
POST /cloudhound/portal-tool-users/

Request body:
{
  "selected_aws_account_id": "123456789012",
  "cognito_user_id": "user-cognito-id",
  "email": "user@example.com"
}
```

## Development

### Install Dependencies
```bash
npm install
```

### Start Dev Server
```bash
npm run dev
```

Server will start at `http://localhost:5173/`

### Build for Production
```bash
npm run build
```

Output goes to `dist/` directory

### Preview Production Build
```bash
npm run preview
```

### Lint Code
```bash
npm run lint
```

## Component Architecture

### CloudHoundPortal Component

The main portal component (`CloudHoundPortal.tsx`) handles:
- Account selection state management
- Tab navigation (Results/Graph/Access)
- Data fetching from API client
- Filtering and display logic
- Form handling for user management

**Key State:**
- `selectedAwsAccountId`: Currently selected AWS account
- `latestResult`: Latest scan result data
- `graph`: Neo4j graph data
- `toolUsers`: List of tool users for the account
- `activeTab`: Current active tab
- `loading`: Global loading state
- `errors`: Error messages by section

### API Client (`cloudhound-api.ts`)

Provides typed HTTP methods:
- `getCloudHoundLatestResult(accountId)`: Fetch latest scan
- `getCloudHoundGraph(params)`: Fetch graph data
- `getCloudHoundToolUsers(accountId)`: List users
- `addCloudHoundToolUser(params)`: Add new user

Includes TypeScript interfaces for all request/response types.

## UI Components

Custom UI components built with Tailwind CSS:
- **Card**: Container component with borders and padding
- **Badge**: Severity/status indicators with color variants
- **Tabs**: Tab navigation with icons
- **Alert**: Error/warning/info/success messages

## Error Handling

The portal includes comprehensive error handling:
- API request errors display in Alert components
- Form validation errors for user management
- Loading states during async operations
- Graceful degradation when features unavailable

## Response Types

### CloudHoundLaunchResultResponse
```typescript
{
  id: string;
  job_id: string;
  status: 'queued' | 'running' | 'pending' | 'success' | 'failed';
  current_step: string;
  progress_percent: number;
  findings: CloudHoundFinding[];
  risk_scores: CloudHoundRiskScore[];
  scan_diffs: CloudHoundScanDiff[];
  findings_count: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  info_count: number;
}
```

### CloudHoundPortalGraphResponse
```typescript
{
  configured: boolean;
  query_key: string;
  nodes: CloudHoundPortalGraphNode[];
  edges: CloudHoundPortalGraphEdge[];
  metrics: {
    total_nodes: number;
    total_edges: number;
    high_risk_entities: number;
  };
  detail: string;
}
```

### CloudHoundPortalToolUser
```typescript
{
  id: string;
  cognito_user_id: string;
  email: string;
  is_active: boolean;
  created_at: string;
}
```

## Deployment

### Docker Build (Optional)
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
ENV VITE_API_BASE_URL=https://api.prod.com/api
CMD ["npm", "run", "preview"]
```

### Static Hosting
```bash
npm run build
# Upload dist/ folder to static hosting (S3, Netlify, Vercel, etc.)
```

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari 14+, Chrome Android)

## Troubleshooting

### API Connection Issues
1. Check `VITE_API_BASE_URL` in `.env.local`
2. Verify backend is running and accessible
3. Check CORS headers in backend response
4. Ensure auth token is valid and in localStorage

### Build Errors
```bash
# Clear node_modules and rebuild
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Dev Server Issues
```bash
# Kill any existing Vite processes
pkill -f "vite"
npm run dev
```

## Contributing

1. Follow TypeScript strict mode guidelines
2. Use React hooks and functional components
3. Add error handling for all API calls
4. Update types when API response changes
5. Test responsive design on mobile

## License

CloudFruition - Internal Use Only

## Support

For issues or questions:
1. Check backend API endpoints are running
2. Review browser console for errors
3. Check network tab for API responses
4. Verify authentication token validity
