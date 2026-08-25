import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { IS_ELECTRON } from "./utils.mjs";

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    if (IS_ELECTRON && window.electronAPI?.addAppLog) {
      window.electronAPI.addAppLog("ERROR", "react", `Render error: ${error.message}\n${info.componentStack}`);
    } else {
      console.error(error, info);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "40px", fontFamily: "sans-serif", color: "#e2e2e2", background: "#1e1e1e", height: "100vh", boxSizing: "border-box" }}>
          <h2 style={{ color: "#f87171" }}>Algo salió mal (Error de la aplicación)</h2>
          <p>Se ha producido un error inesperado al renderizar la interfaz.</p>
          <pre style={{ background: "#000", padding: "16px", borderRadius: "8px", overflowX: "auto", fontSize: "12px", border: "1px solid #333" }}>
            {this.state.error?.stack || this.state.error?.message}
          </pre>
          <button 
            onClick={() => window.location.reload()}
            style={{ marginTop: 20, padding: "8px 16px", background: "#3b82f6", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}>
            Recargar Aplicación
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Global unhandled error logging
window.addEventListener("error", (event) => {
  if (IS_ELECTRON && window.electronAPI?.addAppLog) {
    window.electronAPI.addAppLog("ERROR", "window", `Uncaught error: ${event.message} at ${event.filename}:${event.lineno}`);
  }
});
window.addEventListener("unhandledrejection", (event) => {
  if (IS_ELECTRON && window.electronAPI?.addAppLog) {
    window.electronAPI.addAppLog("ERROR", "window", `Unhandled rejection: ${event.reason}`);
  }
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
