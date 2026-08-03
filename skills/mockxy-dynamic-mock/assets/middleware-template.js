// Middleware template: rename to <NNN>.middleware.js inside the <METHOD>.responses/ folder and
// reference it from the matching <NNN>.response.json ({ "type": "middleware", "sourceFile": ... }).
//
// The request really reaches the backend: this script only transforms the response coming back.
// Returning undefined lets it through untouched. Do not declare method, path or disabled here.
module.exports = {
  // Context: status, headers, bodyBuffer, bodyText, jsonBody, req, targetUrl, data.
  async transformResponse({ status, headers, jsonBody }) {
    return {
      status,
      headers: { ...headers, "x-transformed-by": "mockxy" },
      jsonBody: { ...jsonBody },
    };
  },
};
