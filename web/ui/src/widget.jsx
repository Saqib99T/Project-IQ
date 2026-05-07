import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import ChatWindow from './widget/components/ChatWindow'

// Use the current page's origin as the Admin API URL
// Since we're running on port 80 (default HTTP), just use the origin directly
const ADMIN_API_URL = window.location.origin;

class GlpiChatWidget extends HTMLElement {
    constructor() {
        super();
        console.log("GLPI Widget: Constructor called");
        this.mountPoint = null;
        this.root = null;
        this.themeData = null; // Cached theme data
    }

    connectedCallback() {
        console.log("GLPI Widget: Connected callback");
        try {
            if (!this.mountPoint) {
                this.mountPoint = document.createElement('div');
                this.appendChild(this.mountPoint);
                this.root = createRoot(this.mountPoint);
                console.log("GLPI Widget: Root created");
            }
            this.loadAndRender();
        } catch (e) {
            console.error("Widget Crash:", e);
        }
    }

    static get observedAttributes() {
        return ['title', 'app-id', 'theme-id'];
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue !== newValue) {
            // If theme-id changed, reload theme data
            if (name === 'theme-id') {
                this.themeData = null;
            }
            this.loadAndRender();
        }
    }

    async loadAndRender() {
        const themeIdAttr = this.getAttribute('theme-id');

        // If theme-id is a number, fetch theme from API
        if (themeIdAttr && !themeIdAttr.startsWith('#') && !isNaN(themeIdAttr)) {
            if (!this.themeData || this.themeData.id !== parseInt(themeIdAttr)) {
                try {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 3000);
                    const res = await fetch(`${ADMIN_API_URL}/admin/themes/${themeIdAttr}`, { signal: controller.signal });
                    clearTimeout(timeout);
                    const data = await res.json();
                    if (data.success && data.theme) {
                        // Handle settings as either JSON string or object
                        const settings = typeof data.theme.settings === 'string'
                            ? JSON.parse(data.theme.settings)
                            : data.theme.settings;
                        this.themeData = {
                            id: data.theme.id,
                            ...settings
                        };
                        console.log("GLPI Widget: Loaded theme", this.themeData);
                    }
                } catch (e) {
                    console.warn("GLPI Widget: Failed to load theme", e);
                }
            }
        } else if (themeIdAttr && themeIdAttr.startsWith('#')) {
            // Direct color value (legacy support)
            this.themeData = { primaryColor: themeIdAttr };
        } else {
            this.themeData = null;
        }

        this.render();
    }

    render() {
        if (!this.root) return;

        const title = this.getAttribute('title') || 'Project IQ';
        const appId = this.getAttribute('app-id') || 'General';

        this.root.render(
            <StrictMode>
                <ChatWindow title={title} appId={appId} theme={this.themeData} />
            </StrictMode>
        );
    }

    disconnectedCallback() {
        if (this.root) {
            this.root.unmount();
        }
    }
}

// Define the custom element
if (!customElements.get('glpi-chat-widget')) {
    customElements.define('glpi-chat-widget', GlpiChatWidget);
    console.log("GLPI Widget: Registered <glpi-chat-widget>");
}

