import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import "./styles/index.css";
import "./styles/mobile.css";
import { testConnection } from "./app/components/api/supabase-client";
testConnection();
createRoot(document.getElementById("root")!).render(<App />);
