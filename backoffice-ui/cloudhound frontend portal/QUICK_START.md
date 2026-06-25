# CloudHound Frontend Portal - Quick Start Guide

## Prerequisites

- Node.js 18+ and npm 9+
- CloudFruition backend running (Django development server)
- AWS credentials configured for the backend

## Quick Start - 5 Minutes

### 1. Install Dependencies
```bash
cd cloudhound\ frontend\ portal
npm install
```

### 2. Configure Environment
Create `.env.local` with your backend URL:
```bash
echo "VITE_API_BASE_URL=http://localhost:8000/api" > .env.local
```

### 3. Start Development Server
```bash
npm run dev
```

Portal will be available at: **http://localhost:5173**

### 4. Access the Portal

1. Navigate to http://localhost:5173
2. Ensure you're authenticated with the backend (JWT token in localStorage)
3. Select an AWS account from the dropdown
4. Explore the three tabs:
   - **Scan Results**: View latest CloudHound findings
   - **Graph Explorer**: Visualize IAM topology
   - **Access Management**: Add/manage tool users

## Backend Setup (If Needed)

If CloudFruition backend is not running:

```bash
cd cf_solutions_backend
source venv/bin/activate
python manage.py runserver 0.0.0.0:8000
```

Ensure these models exist:
- CustomerAccount
- CloudHoundLaunchResult  
- CloudHoundScanRun
- CloudHoundFinding
- CloudHoundRiskScore
- CloudHoundScanDiff

Run migrations if not already applied:
```bash
python manage.py migrate service_solutions
```

## Common Issues & Solutions

### 1. API Connection Refused
**Problem**: "Failed to connect to backend"

**Solution**:
1. Check backend is running: `curl http://localhost:8000/api/cloudhound/`
2. Check VITE_API_BASE_URL in .env.local
3. Verify CORS headers in Django settings

### 2. Authentication Failed
**Problem**: "401 Unauthorized" errors

**Solution**:
1. Ensure you have a valid JWT token
2. Store token in localStorage: `localStorage.setItem('authToken', 'your-token')`
3. Test auth endpoint: `curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:8000/api/cloudhound/`

### 3. Build Errors
**Problem**: "npm run build" fails

**Solution**:
```bash
# Clean reinstall
rm -rf node_modules package-lock.json dist
npm install
npm run build
```

### 4. Port Already in Use
**Problem**: "Port 5173 is already in use"

**Solution**:
```bash
# Kill existing process
lsof -ti:5173 | xargs kill -9
npm run dev
```

## Development Workflow

### File Structure
```
src/
├── api/cloudhound-api.ts        # API client - edit to change endpoints
├── components/CloudHoundPortal.tsx  # Main component - edit to change UI
├── App.tsx                       # App entry point
└── index.css                     # Tailwind CSS imports
```

### Adding New Features

1. **New API Method**:
   - Add method to `src/api/cloudhound-api.ts`
   - Add TypeScript interface for response

2. **New UI Component**:
   - Create component in `src/components/`
   - Import in CloudHoundPortal.tsx

3. **Styling**:
   - Use Tailwind CSS class names
   - Customize in `tailwind.config.js` if needed

### Testing API Responses

```bash
# Test latest result endpoint
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:8000/api/cloudhound/portal-latest-result/?selected_aws_account_id=123456789012"

# Test graph endpoint
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:8000/api/cloudhound/portal-graph/?selected_aws_account_id=123456789012&query_key=iam_topology"

# Test users endpoint
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:8000/api/cloudhound/portal-tool-users/?selected_aws_account_id=123456789012"
```

## Building for Production

```bash
# Create optimized production build
npm run build

# Preview production build locally
npm run preview

# Deploy dist/ folder to your hosting provider
# Examples:
# - AWS S3 + CloudFront
# - Netlify
# - Vercel
# - Your own server
```

## Environment Configuration

### Local Development (.env.local)
```env
VITE_API_BASE_URL=http://localhost:8000/api
```

### Staging (.env.staging)
```env
VITE_API_BASE_URL=https://staging-api.cloudfruition.com/api
```

### Production (.env.production)
```env
VITE_API_BASE_URL=https://api.cloudfruition.com/api
```

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Create production build
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint
- `npm run type-check` - Check TypeScript types

## Debugging Tips

### 1. Browser DevTools
- Open DevTools (F12)
- Check Console for errors
- Check Network tab for API requests
- Check Application > Local Storage for auth token

### 2. Backend Logs
```bash
# Watch Django server logs
tail -f cf_solutions_backend/logs/*.log
```

### 3. API Response Inspection
In browser console:
```javascript
// Check what's stored
console.log(localStorage.getItem('authToken'));

// Test API directly
fetch('http://localhost:8000/api/cloudhound/portal-latest-result/?selected_aws_account_id=123456789012', {
  headers: { 'Authorization': 'Bearer ' + localStorage.getItem('authToken') }
}).then(r => r.json()).then(console.log);
```

## Performance Optimization

The project is pre-configured for optimal performance:
- Vite for fast HMR and builds
- Tailwind CSS for minimal CSS output
- React 19 with latest optimizations
- Code splitting automatically handled by Vite

Additional optimization:
- Lazy load components if list grows
- Implement pagination for findings/users
- Add request caching in API client

## Deployment Checklist

- [ ] Set correct VITE_API_BASE_URL for environment
- [ ] Test all three portal tabs
- [ ] Verify account selector works
- [ ] Test user addition in Access Management
- [ ] Check responsive design on mobile
- [ ] Verify error handling with offline backend
- [ ] Check Console for any warnings/errors
- [ ] Test in multiple browsers

## Support & Troubleshooting

For additional help:
1. Check README_PORTAL.md for full documentation
2. Review backend API endpoints in service_solutions/views/cloudhound.py
3. Check TypeScript types in src/api/cloudhound-api.ts
4. Verify backend serializers in service_solutions/serializers/cloudhound_serializers.py

## Next Steps

1. **Authentication Integration**:
   - Integrate with AWS Cognito
   - Implement login/logout flows
   - Store JWT tokens securely

2. **Real Data Connection**:
   - Update mock account list with real data from backend
   - Fetch customer accounts from database

3. **Enhanced Features**:
   - Add graph visualization library (Cytoscape.js)
   - Implement real-time WebSocket updates
   - Add export/report generation
   - Add saved graph queries

4. **Performance**:
   - Implement request caching
   - Add pagination for large datasets
   - Optimize bundle size

Happy coding! 🚀
