const mode = import.meta.env.MODE;

var API_SERVER = "http://localhost:3000";

if (mode === "development") {
  API_SERVER = "http://localhost:3000";
}

if (mode === "production") {
  API_SERVER = "http://8.136.110.55:8888";
}

export { API_SERVER };
