// Handler template: rename to <NNN>.handler.js inside the <METHOD>.responses/ folder and
// reference it from the matching <NNN>.response.json ({ "type": "handler", "sourceFile": ... }).
//
// Do not declare method, path or disabled here: routing belongs to the endpoint file.
module.exports = {
  // Context: params, query, requestHeaders, bodyBuffer, bodyText, jsonBody,
  //          data, state, callCount, firstRequestAt, req.
  async resolveResponse({ params, query, requestHeaders, jsonBody, data }) {
    // const items = await data("dataset-name"); // reads files/dataset-name.json

    return {
      status: 200,
      headers: { "x-source": "handler" },
      jsonBody: { params, query, requestBody: jsonBody ?? null },
    };
  },
};
