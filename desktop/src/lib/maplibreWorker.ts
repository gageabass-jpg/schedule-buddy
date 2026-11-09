// MapLibre 6 loads its web worker as a separate module file that it expects to
// find next to the main bundle (assets/maplibre-gl-worker.mjs). Vite never emits
// that file unless something imports it, so the packaged app's server answered
// the request with index.html and the map sat on its loading dots forever.
// Importing the worker as an asset makes Vite ship it; setWorkerUrl points
// MapLibre at the shipped copy. Imported by components/ui/mapcn-marker-tooltip.
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

setWorkerUrl(workerUrl);
