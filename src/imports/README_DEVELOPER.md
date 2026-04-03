# 🧑‍💻 World SOS - Developer README

<div dir="rtl">

## 👋 مرحباً بك في World SOS!

هذا المستند مخصص للمطورين الذين سيعملون على تطوير أو صيانة منصة World SOS.

</div>

---

## 📋 Table of Contents

1. [Project Overview](#project-overview)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Getting Started](#getting-started)
5. [Development Workflow](#development-workflow)
6. [Key Concepts](#key-concepts)
7. [Testing](#testing)
8. [Deployment](#deployment)
9. [Troubleshooting](#troubleshooting)

---

## Project Overview

**World SOS** is a comprehensive safety platform with three main components:

1. **📱 Mobile App** - For individuals and company employees
2. **🏢 Company Web Dashboard** - For company admins to manage employees
3. **👑 Super Admin Dashboard** - Internal control panel

### Core Features

- **Emergency SOS System** - Press & hold SOS triggers automated call escalation
- **Call Escalation Engine** - Smart routing based on duty status
- **Safe Trip** - Auto-alert if user doesn't check-in on time
- **Company Mode** - Employee safety management
- **Real-time Updates** - WebSocket subscriptions for live status

---

## Tech Stack

### Frontend
```
- React 18 + TypeScript
- Vite (build tool)
- Tailwind CSS v4 (styling)
- React Router (routing)
- Recharts (charts/graphs)
- Lucide React (icons)
```

### Backend
```
- Supabase (BaaS)
  - PostgreSQL + PostGIS (database)
  - Edge Functions (serverless)
  - Auth (phone OTP + Google OAuth)
  - Real-time subscriptions
  
- Twilio
  - Voice calls
  - SMS messages
```

### Mobile (Planned)
```
- Flutter or React Native
- Supabase SDK
- Native location services
```

---

## Project Structure

```
world-sos/
├── src/
│   ├── app/
│   │   ├── App.tsx                    # Main app entry
│   │   ├── components/                # React components
│   │   │   ├── mobile/                # Mobile app views
│   │   │   ├── company/               # Company dashboard
│   │   │   ├── admin/                 # Super admin
│   │   │   └── worldsos/              # Design system components
│   │   └── pages/                     # Page-level components
│   ├── lib/
│   │   └── supabaseClient.ts          # Supabase client config
│   ├── services/
│   │   ├── emergencyService.ts        # Mock emergency service
│   │   └── emergencyServiceProduction.ts  # Real Supabase service
│   └── styles/                        # Global styles
│
├── supabase/
│   ├── schema.sql                     # Complete database schema
│   ├── functions/                     # Edge Functions
│   │   ├── create-emergency/          # Create emergency + dispatch
│   │   ├── dispatch-emergency/        # Call escalation engine
│   │   ├── send-sms/                  # SMS sending
│   │   ├── twilio-webhook/            # Twilio callbacks
│   │   └── update-location/           # Location updates
│   └── .env.example                   # Environment template
│
├── docs/                              # Documentation
│   ├── DEVELOPER_BLUEPRINT.md         # Complete system blueprint
│   ├── QUICK_START_DEVELOPER.md       # Quick start guide
│   ├── BACKEND_INTEGRATION_GUIDE.md   # Frontend-backend integration
│   └── DEPLOYMENT_GUIDE.md            # Production deployment
│
└── package.json                       # Dependencies
```

---

## Getting Started

### Prerequisites

```bash
- Node.js 18+ (https://nodejs.org/)
- npm or pnpm
- Supabase CLI (npm install -g supabase)
- Git
```

### Installation

```bash
# 1. Clone repository
git clone https://github.com/your-org/world-sos.git
cd world-sos

# 2. Install dependencies
npm install

# 3. Create environment file
cp .env.example .env.local

# Edit .env.local with your Supabase credentials:
# VITE_SUPABASE_URL=https://xxxxx.supabase.co
# VITE_SUPABASE_ANON_KEY=eyJhbGc...

# 4. Run development server
npm run dev

# Open http://localhost:5173
```

### Database Setup (Optional for local development)

```bash
# Start local Supabase
supabase start

# This will give you:
# - Local PostgreSQL database
# - Local Edge Functions runtime
# - Studio UI at http://localhost:54323

# Apply schema
supabase db reset

# Or connect to production:
supabase link --project-ref YOUR_PROJECT_REF
```

---

## Development Workflow

### 1. Frontend Development

```bash
# Run dev server with hot reload
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### 2. Backend Development (Edge Functions)

```bash
# Serve functions locally
supabase functions serve

# Deploy function
supabase functions deploy FUNCTION_NAME

# View logs
supabase functions logs FUNCTION_NAME --tail
```

### 3. Database Changes

```bash
# Create migration
supabase migration new MIGRATION_NAME

# Apply migrations
supabase db push

# Reset database (WARNING: deletes data)
supabase db reset
```

---

## Key Concepts

### Emergency Flow

```
1. User presses SOS (3-second hold)
   ↓
2. Frontend calls emergencyServiceProduction.createEmergency()
   ↓
3. Edge Function: create-emergency
   - Saves emergency to DB
   - Sends SMS to all contacts
   - Triggers dispatch-emergency
   ↓
4. Edge Function: dispatch-emergency
   - Builds escalation sequence
   - Makes Twilio calls (20s each)
   - Waits for answer or moves to next
   ↓
5. Twilio calls webhook when answered
   ↓
6. Edge Function: twilio-webhook
   - Marks emergency as resolved
   - Cancels pending calls
   - Sends location to answerer
```

### Call Escalation Policy

**On Duty:**
```
Cycle 1: Admin → Contact2 → Contact3
Cycle 2: Admin → Contact2 → Contact3
```

**Off Duty:**
```
Cycle 1: Contact2 → Contact3
Cycle 2: Contact2 → Contact3
```

Settings (configurable per company):
- `ring_seconds`: 20 (default)
- `max_cycles`: 2 (default)
- `admin_enabled_only_in_duty`: true (default)

### Real-time Updates

```typescript
// Subscribe to emergency updates
const unsubscribe = emergencyServiceProduction.subscribeToEmergency(
  emergencyId,
  (emergency) => {
    console.log('Emergency updated:', emergency);
    setEmergency(emergency);
  }
);

// Cleanup
return () => unsubscribe();
```

### Authentication

```typescript
// Phone OTP
await supabase.auth.signInWithOtp({ phone: '+966501234567' });
await supabase.auth.verifyOtp({ phone, token: '123456', type: 'sms' });

// Google OAuth
await supabase.auth.signInWithOAuth({ provider: 'google' });

// Get session
const { data: { session } } = await supabase.auth.getSession();
```

---

## Testing

### Manual Testing

```bash
# Test emergency creation
1. Login to app
2. Go to mobile home
3. Press & hold SOS button (3 seconds)
4. Verify SMS sent
5. Verify calls made
6. Answer call
7. Verify emergency resolved

# Test company dashboard
1. Login as company admin
2. View active emergencies
3. Check real-time updates
4. Verify location on map
```

### API Testing (with curl)

```bash
# Get JWT token first
curl -X POST https://YOUR_PROJECT.supabase.co/auth/v1/token?grant_type=password \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}'

# Copy access_token from response

# Test create emergency
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/create-emergency \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "emergency_type": "danger",
    "latitude": 24.7136,
    "longitude": 46.6753,
    "accuracy": 10
  }'
```

### Database Testing

```sql
-- Check emergency created
SELECT * FROM emergencies WHERE started_at > NOW() - INTERVAL '5 minutes';

-- Check call attempts
SELECT * FROM call_attempts 
WHERE emergency_id = 'YOUR_EMERGENCY_ID' 
ORDER BY created_at;

-- Check actions log
SELECT * FROM emergency_actions 
WHERE emergency_id = 'YOUR_EMERGENCY_ID' 
ORDER BY created_at;
```

---

## Deployment

### Quick Deploy

```bash
# Frontend (Vercel)
vercel --prod

# Backend (Supabase)
supabase functions deploy --all
supabase db push
```

### Full Deployment Guide

راجع [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) للتفاصيل الكاملة.

---

## Troubleshooting

### Common Issues

#### 1. "Missing authorization header"

```typescript
// Make sure user is logged in
const { data: { session } } = await supabase.auth.getSession();
if (!session) {
  window.location.href = '/login';
}
```

#### 2. "Emergency not found"

```typescript
// Check RLS policies
// User can only see their own emergencies or company emergencies
```

#### 3. "Twilio call failed"

```bash
# Check phone number format (must be E.164)
const phone = '+966501234567'; // ✅ Correct
const phone = '0501234567';    // ❌ Wrong

# Check Twilio logs
https://console.twilio.com/logs
```

#### 4. Location permission denied

```typescript
navigator.geolocation.getCurrentPosition(
  success,
  (error) => {
    if (error.code === error.PERMISSION_DENIED) {
      alert('Please enable location access');
    }
  }
);
```

#### 5. Real-time not working

```typescript
// Make sure to unsubscribe on cleanup
useEffect(() => {
  const unsubscribe = subscribeToEmergency(...);
  return () => unsubscribe(); // This is critical!
}, []);
```

### Debug Tools

```bash
# View Supabase logs
supabase functions logs FUNCTION_NAME --tail

# View Twilio logs
https://console.twilio.com/logs

# View browser console
F12 → Console

# Check network requests
F12 → Network

# View database state
Supabase Studio → SQL Editor
```

---

## Code Style Guide

### TypeScript

```typescript
// Use interfaces for objects
interface Emergency {
  id: string;
  status: 'active' | 'resolved';
  // ...
}

// Use async/await (not .then)
const emergency = await emergencyService.getEmergency(id); // ✅
emergencyService.getEmergency(id).then(...);              // ❌

// Handle errors
try {
  await createEmergency();
} catch (error) {
  console.error('Error:', error);
  // Show user-friendly message
}
```

### React

```typescript
// Use functional components
export function Component() { } // ✅
export class Component { }      // ❌

// Use hooks
const [state, setState] = useState();

// Clean up side effects
useEffect(() => {
  const unsubscribe = subscribe();
  return () => unsubscribe(); // Cleanup
}, []);
```

### Naming Conventions

```typescript
// Components: PascalCase
export function EmergencyButton() {}

// Functions: camelCase
async function createEmergency() {}

// Constants: UPPER_SNAKE_CASE
const MAX_RETRIES = 3;

// Files: kebab-case
emergency-service.ts
control-room.tsx
```

---

## Important Files Reference

| File | Purpose |
|------|---------|
| `DEVELOPER_BLUEPRINT.md` | Complete system architecture |
| `QUICK_START_DEVELOPER.md` | 30-minute quick start |
| `BACKEND_INTEGRATION_GUIDE.md` | How to connect frontend to backend |
| `DEPLOYMENT_GUIDE.md` | Production deployment steps |
| `supabase/schema.sql` | Complete database schema |
| `src/lib/supabaseClient.ts` | Supabase client configuration |
| `src/services/emergencyServiceProduction.ts` | Production emergency service |

---

## Useful Commands

```bash
# Development
npm run dev                    # Start dev server
npm run build                  # Build for production

# Supabase
supabase start                 # Start local instance
supabase functions serve       # Serve functions locally
supabase functions deploy      # Deploy functions
supabase db push               # Push schema changes
supabase db reset              # Reset database
supabase migration new NAME    # Create migration
supabase secrets set KEY=VAL   # Set secret
supabase secrets list          # List secrets
supabase functions logs NAME   # View function logs

# Git
git status                     # Check status
git add .                      # Stage changes
git commit -m "message"        # Commit
git push                       # Push to remote

# Deployment
vercel --prod                  # Deploy frontend
```

---

## Environment Variables

### Frontend (.env.local)
```bash
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
VITE_GOOGLE_MAPS_API_KEY=AIzaSy... # Optional
```

### Backend (Supabase Secrets)
```bash
TWILIO_ACCOUNT_SID=ACxxxxx
TWILIO_AUTH_TOKEN=xxxxx
TWILIO_PHONE_NUMBER=+1234567890
TWILIO_WEBHOOK_URL=https://xxxxx.supabase.co/functions/v1/twilio-webhook
```

---

## Performance Tips

```typescript
// 1. Use React.memo for expensive components
export const ExpensiveComponent = React.memo(({ data }) => {
  // ...
});

// 2. Debounce search inputs
const debouncedSearch = useDebounce(searchTerm, 300);

// 3. Paginate large lists
const { data } = await supabase
  .from('emergencies')
  .select('*')
  .range(0, 49); // First 50 items

// 4. Use indexes in database (already in schema.sql)
CREATE INDEX idx_emergencies_status ON emergencies(status);

// 5. Unsubscribe from real-time when not needed
useEffect(() => {
  const unsub = subscribe();
  return () => unsub();
}, []);
```

---

## Security Checklist

```bash
✅ Never commit .env.local to Git
✅ Never use service_role key in frontend
✅ Always validate user input
✅ Use RLS policies (already configured)
✅ Sanitize SQL queries (use Supabase client)
✅ HTTPS only in production
✅ Rate limiting enabled
✅ CORS configured correctly
```

---

## Resources

### Documentation
- [Supabase Docs](https://supabase.com/docs)
- [React Docs](https://react.dev)
- [Tailwind CSS](https://tailwindcss.com)
- [Twilio Docs](https://www.twilio.com/docs)

### Tools
- [Supabase Studio](https://supabase.com/dashboard) - Database GUI
- [Postman](https://www.postman.com/) - API testing
- [React DevTools](https://react.dev/learn/react-developer-tools) - React debugging

### Community
- [Supabase Discord](https://discord.supabase.com)
- [React Discord](https://discord.gg/react)

---

## Contributing

### Pull Request Process

1. Create feature branch: `git checkout -b feature/your-feature`
2. Make changes and test thoroughly
3. Commit with clear message: `git commit -m "Add: feature description"`
4. Push: `git push origin feature/your-feature`
5. Create Pull Request on GitHub
6. Wait for code review

### Commit Message Format

```
Type: Short description

Types:
- Add: New feature
- Fix: Bug fix
- Update: Modify existing feature
- Refactor: Code restructuring
- Docs: Documentation changes
- Style: Code formatting
- Test: Add tests

Example:
Add: Real-time emergency updates
Fix: Location permission handling
Update: Call escalation timeout to 20s
```

---

## FAQ

**Q: Can I use this in production?**
A: Yes, but make sure to follow the DEPLOYMENT_GUIDE.md first.

**Q: How do I test without Twilio?**
A: Use the mock service in `emergencyService.ts` for frontend testing.

**Q: Can I customize the call escalation logic?**
A: Yes, edit `/supabase/functions/dispatch-emergency/index.ts`

**Q: How do I add a new table?**
A: Create migration: `supabase migration new add_table_name`, edit SQL, then `supabase db push`

**Q: Where are the logs?**
A: `supabase functions logs FUNCTION_NAME --tail`

**Q: How do I reset everything?**
A: `supabase db reset` (WARNING: deletes all data)

---

## Support

إذا واجهت مشاكل:
1. ✅ Check this README
2. ✅ Read DEVELOPER_BLUEPRINT.md
3. ✅ Check logs: `supabase functions logs`
4. ✅ Review Twilio console
5. ✅ Create issue on GitHub

---

**Last Updated:** February 2026  
**Version:** 1.0  
**Maintainer:** World SOS Development Team

---

<div dir="rtl">

## 🎉 مبروك!

أنت الآن جاهز للعمل على World SOS. 

**Next Steps:**
1. اقرأ [QUICK_START_DEVELOPER.md](./QUICK_START_DEVELOPER.md) لبدء سريع
2. راجع [DEVELOPER_BLUEPRINT.md](./DEVELOPER_BLUEPRINT.md) لفهم النظام بالكامل
3. ابدأ التطوير! 🚀

</div>

**Happy Coding! 💻**
