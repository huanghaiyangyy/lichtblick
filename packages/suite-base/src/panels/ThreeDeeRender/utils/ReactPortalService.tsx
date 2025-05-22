import React from 'react';
import ReactDOM from 'react-dom';

class ReactPortalService {
  private static instance: ReactPortalService;
  private portalContainers: Map<string, HTMLElement> = new Map();

  private constructor() {}

  public static getInstance(): ReactPortalService {
    if (!ReactPortalService.instance) {
      ReactPortalService.instance = new ReactPortalService();
    }
    return ReactPortalService.instance;
  }

  public createPortal(id: string, component: React.ReactNode): void {
    // Remove any existing portal with this ID
    this.removePortal(id);

    // Create new container
    const container = document.createElement('div');
    container.id = `portal-${id}`;
    document.body.appendChild(container);
    this.portalContainers.set(id, container);

    // Render component to portal
    ReactDOM.render(<React.StrictMode>{component}</React.StrictMode>, container);
  }

  public removePortal(id: string): void {
    const container = this.portalContainers.get(id);
    if (container) {
      ReactDOM.unmountComponentAtNode(container);
      container.remove();
      this.portalContainers.delete(id);
    }
  }
}

export default ReactPortalService;
