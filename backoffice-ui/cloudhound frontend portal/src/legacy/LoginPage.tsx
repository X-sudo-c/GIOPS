import { useState, useEffect, useRef } from 'react';
import { Shield, AlertCircle, Loader2, Network, Users } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

interface LoginPageProps {
  onSuccess: () => void;
}

export default function LoginPage({ onSuccess }: LoginPageProps) {
  const [impactStarted, setImpactStarted] = useState(false);
  const [coolingStarted, setCoolingStarted] = useState(false);
  const [lightMode, setLightMode] = useState(false);
  const lightModeTimerRef = useRef<number | null>(null);
  const impactResetTimerRef = useRef<number | null>(null);
  const darkModeTimerRef = useRef<number | null>(null);
  const coolingResetTimerRef = useRef<number | null>(null);

  const shootingStars = [
    { top: '12%', left: '-16%', delay: '0.4s', duration: '9.5s' },
    { top: '24%', left: '-8%', delay: '2.8s', duration: '11s' },
    { top: '36%', left: '-18%', delay: '5.1s', duration: '10.2s' },
    { top: '48%', left: '-10%', delay: '7.3s', duration: '12.4s' },
    { top: '62%', left: '-20%', delay: '9.6s', duration: '10.8s' },
    { top: '76%', left: '-14%', delay: '12.1s', duration: '11.6s' },
  ];

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const statusPollTimerRef = useRef<number | null>(null);
  const timeoutTimerRef = useRef<number | null>(null);
  const authResolvedRef = useRef(false);

  async function checkSessionAuthenticated(): Promise<boolean> {
    const statusRes = await fetch(`${API_BASE}/cloudhound/cognito/status/`, {
      credentials: 'include',
      cache: 'no-store',
    });
    return statusRes.ok;
  }

  function clearTimers() {
    if (statusPollTimerRef.current !== null) {
      window.clearInterval(statusPollTimerRef.current);
      statusPollTimerRef.current = null;
    }
    if (timeoutTimerRef.current !== null) {
      window.clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
  }

  useEffect(() => {
    ['/cloudhound_wordmark_white.png', '/cloudhound_wordmark_black.png'].forEach((src) => {
      const img = new Image();
      img.src = src;
    });

    return () => {
      if (lightModeTimerRef.current !== null) {
        window.clearTimeout(lightModeTimerRef.current);
      }
      if (impactResetTimerRef.current !== null) {
        window.clearTimeout(impactResetTimerRef.current);
      }
      if (darkModeTimerRef.current !== null) {
        window.clearTimeout(darkModeTimerRef.current);
      }
      if (coolingResetTimerRef.current !== null) {
        window.clearTimeout(coolingResetTimerRef.current);
      }
    };
  }, []);

  function handleActivateLightMode() {
    if (lightMode) return;

    if (lightModeTimerRef.current !== null) {
      window.clearTimeout(lightModeTimerRef.current);
    }
    if (impactResetTimerRef.current !== null) {
      window.clearTimeout(impactResetTimerRef.current);
    }
    if (darkModeTimerRef.current !== null) {
      window.clearTimeout(darkModeTimerRef.current);
    }
    if (coolingResetTimerRef.current !== null) {
      window.clearTimeout(coolingResetTimerRef.current);
    }

    setImpactStarted(false);
    setCoolingStarted(false);

    window.requestAnimationFrame(() => setImpactStarted(true));
    lightModeTimerRef.current = window.setTimeout(() => {
      setLightMode(true);
      lightModeTimerRef.current = null;
    }, 2200);

    impactResetTimerRef.current = window.setTimeout(() => {
      setImpactStarted(false);
      impactResetTimerRef.current = null;
    }, 2500);
  }

  function handleActivateDarkMode() {
    if (!lightMode) return;

    if (lightModeTimerRef.current !== null) {
      window.clearTimeout(lightModeTimerRef.current);
    }
    if (impactResetTimerRef.current !== null) {
      window.clearTimeout(impactResetTimerRef.current);
    }
    if (darkModeTimerRef.current !== null) {
      window.clearTimeout(darkModeTimerRef.current);
    }
    if (coolingResetTimerRef.current !== null) {
      window.clearTimeout(coolingResetTimerRef.current);
    }

    setImpactStarted(false);
    setCoolingStarted(false);
    window.requestAnimationFrame(() => setCoolingStarted(true));

    darkModeTimerRef.current = window.setTimeout(() => {
      setLightMode(false);
      darkModeTimerRef.current = null;
    }, 1120);

    coolingResetTimerRef.current = window.setTimeout(() => {
      setCoolingStarted(false);
      coolingResetTimerRef.current = null;
    }, 1450);
  }

  // Listen for postMessage from the Cognito callback popup

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      // The backend callback sends: { type: "cognito_auth_success" | "cognito_auth_error", message: "..." }
      if (!event.data || typeof event.data !== 'object') return;
      const { type, message } = event.data as { type: string; message?: string };

      if (type === 'cognito_auth_success') {
        authResolvedRef.current = true;
        clearTimers();
        setLoading(false);
        onSuccess();
      } else if (type === 'cognito_auth_error') {
        authResolvedRef.current = true;
        clearTimers();
        setLoading(false);
        setError(message || 'Cognito authentication failed.');
      }
    }

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      clearTimers();
    };
  }, [onSuccess]);

  async function handleLogin() {
    clearTimers();
    authResolvedRef.current = false;
    setError(null);
    setLoading(true);

    try {
      // Get Cognito Hosted UI URL from backend
      const res = await fetch(`${API_BASE}/cloudhound/cognito/login-url/`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Server error ${res.status}`);
      }
      const { authorization_url } = (await res.json()) as { authorization_url: string };

      // Open as popup — backend callback will postMessage back
      const w = 520;
      const h = 640;
      const left = window.screenX + (window.outerWidth - w) / 2;
      const top = window.screenY + (window.outerHeight - h) / 2;
      const popup = window.open(
        authorization_url,
        'cognito_login',
        `width=${w},height=${h},left=${left},top=${top},toolbar=0,menubar=0,location=0`,
      );

      if (!popup) {
        setLoading(false);
        setError('Popup was blocked. Please allow popups for this site and try again.');
        return;
      }

      // Poll backend session status while popup is open.
      statusPollTimerRef.current = window.setInterval(async () => {
        if (authResolvedRef.current) {
          clearTimers();
          return;
        }

        try {
          const authed = await checkSessionAuthenticated();
          if (authed) {
            authResolvedRef.current = true;
            clearTimers();
            setLoading(false);
            onSuccess();
          }
        } catch {
          // Ignore transient network errors while waiting for auth callback.
        }
      }, 1000);

      // Fallback timeout so spinner does not run forever.
      timeoutTimerRef.current = window.setTimeout(() => {
        if (!authResolvedRef.current) {
          clearTimers();
          setLoading(false);
          setError('Login timed out. Please try again.');
        }
      }, 120000);
    } catch (err) {
      clearTimers();
      setLoading(false);
      setError(err instanceof Error ? err.message : 'Failed to start login.');
    }
  }

  return (
    <div className={`login-scene relative min-h-screen bg-black flex overflow-hidden ${lightMode ? 'light-mode' : ''} ${impactStarted ? 'impact-sequence' : ''}`}>
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        <div className="starfield-layer" />
        <div className="starfield-layer-soft" />
        {shootingStars.map((star, index) => (
          <span
            key={index}
            className="shooting-star"
            style={{
              top: star.top,
              left: star.left,
              ['--star-delay' as string]: star.delay,
              ['--star-duration' as string]: star.duration,
            }}
          />
        ))}
        <div className={`asteroid-body ${impactStarted ? 'asteroid-active' : ''}`} />
        <div className={`asteroid-tail ${impactStarted ? 'asteroid-active' : ''}`} />
        <div className={`impact-burst ${impactStarted ? 'impact-active' : ''}`} />
        <div className={`impact-ring ${impactStarted ? 'impact-active' : ''}`} />
        <div className={`impact-flash ${impactStarted ? 'impact-active' : ''}`} />
        <div className={`brightness-pulse ${impactStarted ? 'brightness-active' : ''}`} />
        <div className={`cooling-wave ${coolingStarted ? 'cooling-active' : ''}`} />
        <div className={`cooling-ring ${coolingStarted ? 'cooling-active' : ''}`} />
        <div className={`cooling-fade ${coolingStarted ? 'cooling-active' : ''}`} />
      </div>

      {/* Left Sidebar - Branding */}
      <div className="login-panel relative z-10 hidden md:flex md:w-1/2 bg-black/60 border-r border-slate-800 flex-col items-center justify-center p-12 backdrop-blur-[1px]">
        <div className="w-full max-w-md">
          {/* Professional Logo */}
          <div className="mb-8 w-[440px] max-w-full">
            <span className="login-logo-stack w-52 max-w-full">
              <img src="/cloudhound_wordmark_white.png" alt="CloudHound" className="login-logo login-logo-dark w-full h-auto" />
              <img src="/cloudhound_wordmark_black.png" alt="CloudHound" className="login-logo login-logo-light w-full h-auto" />
            </span>
            <p className="login-muted text-slate-400 text-sm mt-4 whitespace-nowrap">Advanced Threat Detection & IAM Topology Platform</p>
          </div>

          <div className="space-y-6">
            <div className="flex gap-3">
              <Shield className="w-5 h-5 text-orange-600 flex-shrink-0 mt-1" />
              <div>
                <p className="login-heading text-white font-medium text-sm">Real-time Threat Detection</p>
                <p className="login-subtle text-slate-500 text-xs mt-1">Continuous AWS security scanning</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Network className="w-5 h-5 text-orange-600 flex-shrink-0 mt-1" />
              <div>
                <p className="login-heading text-white font-medium text-sm">IAM Topology Mapping</p>
                <p className="login-subtle text-slate-500 text-xs mt-1">Visualize identity relationships</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Users className="w-5 h-5 text-orange-600 flex-shrink-0 mt-1" />
              <div>
                <p className="login-heading text-white font-medium text-sm">Access Management</p>
                <p className="login-subtle text-slate-500 text-xs mt-1">Control platform user permissions</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="login-panel relative z-10 w-full md:w-1/2 bg-black/60 flex items-center justify-center p-6 backdrop-blur-[1px]">
        <div className="w-full max-w-sm">
          {/* Mobile Logo */}
          <div className="md:hidden mb-8 text-center">
            <span className="login-logo-stack w-44 max-w-full mx-auto mb-4">
              <img src="/cloudhound_wordmark_white.png" alt="CloudHound" className="login-logo login-logo-dark w-full h-auto" />
              <img src="/cloudhound_wordmark_black.png" alt="CloudHound" className="login-logo login-logo-light w-full h-auto" />
            </span>
            <p className="login-muted text-slate-400 text-xs">Advanced Threat Detection</p>
          </div>

          {/* Login Card */}
          <div className="login-card bg-slate-900 border border-slate-800 rounded-lg p-8">
            <div className="flex items-center justify-between mb-2">
              <h2 className="login-heading text-lg font-semibold text-white">Security Portal</h2>
              <button
                type="button"
                onClick={lightMode ? handleActivateDarkMode : handleActivateLightMode}
                className="px-3 py-1.5 text-xs font-semibold rounded border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {lightMode ? 'Dark Mode' : 'Light Mode'}
              </button>
            </div>
            <p className="login-muted text-slate-400 text-sm mb-6">Sign in with your Cognito credentials</p>

            {error && (
              <div className="mb-6 flex items-start gap-3 rounded-lg bg-red-950/40 border border-red-900/60 px-4 py-3 text-red-300 text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <p className="login-subtle text-slate-500 text-sm mb-6">
              Access is restricted to administrators who have configured a CloudHound AWS account. Sign in with the same Cognito account used during setup.
            </p>

            {loading && (
              <button
                onClick={() => {
                  authResolvedRef.current = true;
                  clearTimers();
                  setLoading(false);
                  setError('Sign-in cancelled.');
                }}
                className="w-full mb-3 border border-slate-700 hover:border-slate-600 text-slate-400 hover:text-slate-300 font-medium rounded py-2.5 text-sm transition-all"
              >
                Cancel
              </button>
            )}

            <button
              onClick={handleLogin}
              disabled={loading}
              className="w-full bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded py-2.5 text-sm transition-all flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Waiting for Cognito…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.75 11.35a4.32 4.32 0 0 0 .09-.89 4.27 4.27 0 0 0-4.28-4.28 4.3 4.3 0 0 0-2.7.96A3.54 3.54 0 0 0 9.5 6a3.59 3.59 0 0 0-3.58 3.58v.09A3 3 0 0 0 3 12.5 3 3 0 0 0 6 15.5h12a3 3 0 0 0 3-3 3 3 0 0 0-2.25-2.9v-.25z" />
                  </svg>
                  Sign in with AWS Cognito
                </>
              )}
            </button>

            {loading && (
              <p className="text-center text-slate-500 text-xs mt-4">
                A sign-in window has opened. Complete authentication there to continue.
              </p>
            )}
          </div>

          <p className="login-subtle text-center text-slate-600 text-xs mt-6">
            CloudFruition Security Operations
          </p>
        </div>
      </div>
    </div>
  );
}

