import { GiopPortal } from './components/GiopPortal';
import './App.css';

const skipAuth = import.meta.env.VITE_SKIP_AUTH !== 'false';

function App() {
  if (skipAuth) {
    return <GiopPortal />;
  }

  // Legacy CloudHound auth path — kept for reference; GIOP local dev uses VITE_SKIP_AUTH=true
  return <GiopPortal />;
}

export default App;
