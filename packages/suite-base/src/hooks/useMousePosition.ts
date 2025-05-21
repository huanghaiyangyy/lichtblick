import { useState, useEffect } from "react";

export function useMousePosition() {
  const [mouseY, setMouseY] = useState(0);

  useEffect(() => {
    const updateMousePosition = (ev: MouseEvent) => {
      setMouseY(ev.clientY);
    };

    window.addEventListener("mousemove", updateMousePosition);

    return () => {
      window.removeEventListener("mousemove", updateMousePosition);
    };
  }, []);

  return mouseY;
}
