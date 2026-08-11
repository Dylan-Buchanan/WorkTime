import { useEffect, useState } from "react";

export const useMediaQuery = (query: string): boolean => {
    const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);

    useEffect(() => {
        const mediaQueryList = window.matchMedia(query);
        const update = (event: MediaQueryListEvent) => setMatches(event.matches);
        setMatches(mediaQueryList.matches);
        mediaQueryList.addEventListener("change", update);
        return () => mediaQueryList.removeEventListener("change", update);
    }, [query]);

    return matches;
};
