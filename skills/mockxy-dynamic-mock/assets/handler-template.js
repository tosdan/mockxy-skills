// Handler template: rename to <NNN>.handler.js inside the <METHOD>.responses/ folder and
// reference it from the matching <NNN>.response.json ({ "type": "handler", "sourceFile": ... }).
//
// Do not declare method, path or disabled here: routing belongs to the endpoint file.
//
// Local code is required here, at the top, with a literal path and the extension; helpers shared
// by several endpoints live in <mocks>/_shared/ (the alias needs <mocks>/package.json):
// const flow = require("#shared/flow.js");
// Keep no state in module variables: use state and sharedState.
module.exports = {
  // Context: params, query, requestHeaders, bodyBuffer, bodyText, jsonBody,
  //          data, sharedState, state, callCount, firstRequestAt, req.
  async resolveResponse({ params, query, requestHeaders, jsonBody, data, sharedState }) {
    // const items = await data("dataset-name"); // reads files/dataset-name.json
    // const runtimeItems = await sharedState.open("items", {
    //   seedKey: "items@v1",
    //   initialize: () => data("items"),
    // });

    return {
      status: 200,
      headers: { "x-source": "handler" },
      jsonBody: { params, query, requestBody: jsonBody ?? null },
      // applyListQuery: true, // opt in when jsonBody is a list
    };
  },
};
