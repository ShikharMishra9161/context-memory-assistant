import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

// In the side panel the page fills the panel; the fallback popup (?popup=1)
// needs an explicit width because popups size themselves to their content.
if (new URLSearchParams(location.search).has('popup')) document.body.style.width = '440px';

createRoot(document.getElementById('root')).render(<App />);
