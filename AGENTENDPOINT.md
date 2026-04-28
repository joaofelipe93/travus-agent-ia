---
title: How to Use Agents in Your Applications on DigitalOcean AI Platform
description: Use your agent in an application or through a chat bot interface.
product: Ai Platform
url: https://docs.digitalocean.com/products/ai-platform/how-to/use-agents/
last_updated: "2026-02-05"
---

> **For AI agents:** The documentation index is at [https://docs.digitalocean.com/llms.txt](https://docs.digitalocean.com/llms.txt). Markdown versions of pages use the same URL with `index.html.md` in place of the HTML page (for example, append `index.html.md` to the directory path instead of opening the HTML document).

# How to Use Agents in Your Applications on DigitalOcean AI Platform

DigitalOcean AI Platform lets you build fully-managed AI agents with knowledge bases for retrieval-augmented generation, multi-agent routing, guardrails, and more.

You can access your agent through one of the following interfaces:

- **Endpoint**: Endpoints are URLs automatically generated when you create agents. You can integrate them into your app to send requests to and receive JSON responses from. Similar to a chatbot interface, you can send the agent a string of text that the agent processes and responds to. Using an endpoint also allows you to configure additional request parameters, such as maximum tokens to generate and retrieval information settings. Agent endpoints can be private or public:
  - **Private**: Agent endpoints are private by default. This means only other resources in your account, such as [other agents or functions](https://docs.digitalocean.com/products/ai-platform/how-to/route-agents/index.html.md) or requests authenticated with an access key can access the agent.
  - **Public**: Public endpoints allow you to access and use the chatbot embed feature. You do not need to set up an access key to use an embedded chatbot, however, like private endpoints, requests sent directly to an agent’s endpoint still require an [access key](#access-key).

- **Chatbot**: Chatbots allow users to interact with your agent through a chatbot interface that you embed into your site using a snippet of HTML code. The chatbot interface is available only if the agent’s endpoint is public.

Using an endpoint or a chatbot depends on your use case. If you want to integrate your agent into a customized user interface or use it to produce content for your website, an endpoint is a good option. If you want to create a basic technical support chatbot for your company’s website, an embedded chatbot is a better option.

## View Agent Endpoint

You can access the agent’s endpoint URL and its availability status in the control panel or by using the API.

### Using the Control Panel

You can view an agent’s endpoint URL and its availability status in the **ENDPOINT** section of the agent’s **Overview** tab in the [DigitalOcean Control Panel](https://cloud.digitalocean.com).

![Agent endpoint showing endpoint URL and availability status](https://docs.digitalocean.com/screenshots/ai-platform/agent-endpoint.277fd221b0d8ea8214b9550c233e848df3e11b27b92e2e96d18d08518735a97a.png)

### Using Automation

Viewing an agent endpoint requires the unique identifier for the agent. To obtain a list of agents with their unique identifiers, use the [`/v2/gen-ai/agents` endpoint](https://docs.digitalocean.com/reference/api/reference/gradientai-platform/index.html.md#genai_list_agents).

## How to View Agent Endpoint Using the DigitalOcean API

1. [Create a personal access token](https://docs.digitalocean.com/reference/api/create-personal-access-token/index.html.md) and save it for use with the API.
2. Send a GET request to [`https://api.digitalocean.com/v2/gen-ai/agents/{uuid}`](https://docs.digitalocean.com/reference/api/reference/gradientai-platform/index.html.md#genai_get_agent).

### cURL

Using cURL:

```shell
curl -X GET \
  -H "Content-Type: application/json"  \
  -H "Authorization: Bearer $DIGITALOCEAN_TOKEN" \
  "https://api.digitalocean.com/v2/gen-ai/agents/c441bf77-81d6-11ef-bf8f-4e013e2ddde4"
```

The agent endpoint URL and availability status are returned in the `deployment.url` and `deployment.visibility` fields, respectively:

```text


...
    "deployment": {
            ...
            "uuid": "3c683438-xxxx-xxxx-bf8f-4e013e2ddde4",
            "url": "https://qdvqcnyeeqt7td46j26foyxx.agents.do-ai.run",
            "status": "STATUS_RUNNING",
            "visibility": "VISIBILITY_PRIVATE",
            ...
        },

```

## Change Your Agent’s Endpoint Availability

Before using your agent, we recommend setting the endpoint’s availability to determine who can access it and what interfaces are available. You can set the endpoint to either private or public.

### Using the Control Panel

To change endpoint availability in the [DigitalOcean Control Panel](https://cloud.digitalocean.com), click **Agent Platform** under **INFERENCE** in the left menu. Then, in the **Workspaces** tab, select the workspace that contains the agent you want to set an endpoint for and click the agent. In the **ENDPOINT** section of the **Overview** tab, click **Edit** to open the **Set endpoint availability to private** window. Select the availability you want and click **Save**.

### Using Automation

Changing an agent endpoint requires the unique identifier for the agent. To obtain a list of agents with their unique identifiers, use [`doctl gradient agent list`](https://docs.digitalocean.com/reference/doctl/reference/gradient/agent/list/index.html.md) or the [`/v2/gen-ai/agents` endpoint](https://docs.digitalocean.com/reference/api/reference/gradientai-platform/index.html.md#genai_list_agents).

## How to Change Visibility of Agent Endpoint Using the DigitalOcean CLI

1. [Install `doctl`](https://docs.digitalocean.com/reference/doctl/how-to/install/index.html.md), the official DigitalOcean CLI.
2. [Create a personal access token](https://docs.digitalocean.com/reference/api/create-personal-access-token/index.html.md) and save it for use with `doctl`.
3. Use the token to grant `doctl` access to your DigitalOcean account.```shell
   doctl auth init

   ```

   ```

4. Finally, run `doctl gradient agent update-visibility`. Basic usage looks like this, but you can [read the usage docs](https://docs.digitalocean.com/reference/doctl/reference/gradient/agent/update-visibility/index.html.md) for more details:```shell
   doctl gradient agent update-visibility <agent-id> [flags]

   ````

   The following example updates the visibility of an agent with the ID `12345678-1234-1234-1234-123456789012` to `VISIBILITY_PUBLIC`:```shell
   doctl gradient agent update-visibility 12345678-1234-1234-1234-123456789012 --visibility 'VISIBILITY_PUBLIC'
   ````

## How to Change Visibility of Agent Endpoint Using the DigitalOcean API

1. [Create a personal access token](https://docs.digitalocean.com/reference/api/create-personal-access-token/index.html.md) and save it for use with the API.
2. Send a PUT request to [`https://api.digitalocean.com/v2/gen-ai/agents/{uuid}/deployment_visibility`](https://docs.digitalocean.com/reference/api/reference/gradientai-platform/index.html.md#genai_update_agent_deployment_visibility).

### cURL

Using cURL:

```shell
curl -X PUT \
  -H "Content-Type: application/json"  \
  -H "Authorization: Bearer $DIGITALOCEAN_TOKEN" \
  "https://api.digitalocean.com/v2/gen-ai/agents/1b418231-b7d6-11ef-bf8f-4e013e2ddde4/deployment_visibility" \
  -d '{
    "uuid": "1b418231-b7d6-11ef-bf8f-4e013e2ddde4",
    "visibility": "VISIBILITY_PUBLIC"
  }'
```

To use the public endpoint in your app, copy the URL from the `url` field returned in the response:

```text
...
    "deployment": {
            "uuid": "3c683438-xxxx-xxxx-bf8f-4e013e2ddde4",
            "url": "https://qdvqcnyeeqt7td46j26foyxx.agents.do-ai.run",
            ...
        },
```

Setting the endpoint to public also displays a **Chatbot** section with the chatbot ID and a JavaScript code snippet in the **Overview** tab in the control panel. You can copy and paste the code snippet directly into your application, such as WordPress, to use the chatbot. To learn more, see the [community articles on adding chatbots](https://www.digitalocean.com/community/tags/ai-ml).

![Chatbot code snippet showing how to embed the chatbot in an application](https://docs.digitalocean.com/screenshots/ai-platform/chatbot-code-snippet.390fb2b70771bb4dce9d23f44109888f31f0313dc3b1280388deae298d212d5f.png)

## Create an Access Key for an Endpoint

To access an agent’s endpoint from an external source outside of DigitalOcean, you need create an access key. Access keys are used to authenticate requests to the agent’s endpoint.

### Using the Control Panel

To create the access key from the [DigitalOcean Control Panel](https://cloud.digitalocean.com), click **Agent Platform** under **INFERENCE** in the left menu, then in the **Workspaces** tab, select the workspace that contains the agent you want to create an access key for. In the agent’s **Overview** page, click the **Settings** tab. In the **Endpoint Access Keys** section, click **Create Key** to open the **Create Agent Access Key** window. Provide a name for the key in the **Key name** field and click **Create** to see your newly created key. Then, copy the secret key and securely store it. We do not show it again for security reasons.

Once you have the key, you can integrate it into your app to authenticate requests.

### Using Automation

Creating an agent endpoint access key using the DigitalOcean API requires the unique identifier of the agent and a name for the key. To obtain a list of agents with their unique identifiers, use [`doctl gradient agent list`](https://docs.digitalocean.com/reference/doctl/reference/gradient/agent/list/index.html.md) or the [`/v2/gen-ai/agents` endpoint](https://docs.digitalocean.com/reference/api/reference/gradientai-platform/index.html.md#genai_list_agents).

## How to Create an Agent Endpoint Key Using the DigitalOcean CLI

1. [Install `doctl`](https://docs.digitalocean.com/reference/doctl/how-to/install/index.html.md), the official DigitalOcean CLI.
2. [Create a personal access token](https://docs.digitalocean.com/reference/api/create-personal-access-token/index.html.md) and save it for use with `doctl`.
3. Use the token to grant `doctl` access to your DigitalOcean account.

   ```shell
   doctl auth init
   ```

4. Finally, run `doctl gradient openai-key create`. Basic usage looks like this, but you can [read the usage docs](https://docs.digitalocean.com/reference/doctl/reference/gradient/openai-key/create/index.html.md) for more details:

   ```shell
   doctl gradient openai-key create [flags]
   ```

   The following example creates an OpenAI API Key

   ```shell
   doctl gradient openai-key create --name my-key --api-key sk-1234567890abcdef1234567890abcdef
   ```

## How to Create an Agent Endpoint Key Using the DigitalOcean API

1. [Create a personal access token](https://docs.digitalocean.com/reference/api/create-personal-access-token/index.html.md) and save it for use with the API.
2. Send a POST request to [`https://api.digitalocean.com/v2/gen-ai/agents/{agent_uuid}/api_keys`](https://docs.digitalocean.com/reference/api/reference/gradientai-platform/index.html.md#genai_create_agent_api_key).

### cURL

Using cURL:

```shell
curl -X POST \
  -H "Content-Type: application/json"  \
  -H "Authorization: Bearer $DIGITALOCEAN_TOKEN" \
  "https://api.digitalocean.com/v2/gen-ai/agents/1b418231-b7d6-11ef-bf8f-4e013e2ddde4/api_keys" \
  -d '{
    "agent_uuid": "1b418231-b7d6-11ef-bf8f-4e013e2ddde4",
    "name": "test-key"
  }'
```

You can [list all agent API keys](https://docs.digitalocean.com/reference/api/reference/gradientai-platform/index.html.md#genai_list_agent_api_keys), [regenerate a key](https://docs.digitalocean.com/reference/api/reference/gradientai-platform/index.html.md#genai_regenerate_agent_api_key), or [update a key](https://docs.digitalocean.com/reference/api/reference/gradientai-platform/index.html.md#genai_update_agent_api_key) after creation.

## Use Agent’s Endpoints

Once you have an agent, you can use the agent’s endpoint to generate responses to user queries. The following cURL request and Python OpenAI examples show how to use the agent’s endpoint to generate responses to user queries.

### cURL example

You can send requests to the endpoint’s API by appending `/api/v1/chat/completions` to the end of the URL and sending a JSON request body, like in this example cURL request:

```shell
curl -i \
  -X POST \
  $AGENT_ENDPOINT/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AGENT_ACCESS_KEY" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "What is the capital of France?"
      }
    ],
    "stream": false,
    "include_functions_info": true,
    "include_retrieval_info": true,
    "include_guardrails_info": true
  }'
```

In the example, you send a request to the agent’s endpoint to generate a response to the user’s question `What is the capital of France?`. It uses `AGENT_ENDPOINT` and `AGENT_ACCESS_KEY` environment variables to authenticate the request, and [includes response citations](#include-response-citations).

Each endpoint has its own API documentation that you can access by appending `/docs` to the end of the URL. For example, `https://<agent-indentifier>.ondigitalocean.app/docs`. The documentation contains a rendered OpenAPI specification of all available request body parameters and response schemas.

### Python OpenAPI example

The following example shows how to use the [OpenAI Python library](https://platform.openai.com/docs/libraries) to send a request to an agent’s endpoint.

use-agent-endpoint-key.py

```python
# Install OS, JSON, and OpenAI libraries.
import os
import json
from openai import OpenAI

# Set your agent endpoint and access key as environment variables in your OS.
agent_endpoint = os.getenv("agent_endpoint") + "/api/v1/"
agent_access_key = os.getenv("agent_access_key")

if __name__ == "__main__":
    client = OpenAI(
        base_url = agent_endpoint,
        api_key = agent_access_key,
    )

    response = client.chat.completions.create(
        model = "n/a",
        messages = [{"role": "user", "content": "Can you provide the name of France's capital in JSON format."}],
        extra_body = {"include_retrieval_info": True}
    )

# Prints response's content and retrieval object.
    for choice in response.choices:
        print(choice.message.content)

    response_dict = response.to_dict()

    print("\nFull retrieval object:")
    print(json.dumps(response_dict["retrieval"], indent=2))
```

This script sends a request to an agent’s endpoint to return the name of France’s capital in JSON format in the console and its retrieval information. It uses `agent_endpoint` and `agent_access_key` environment variables to authenticate the request. You do not need to append `/chat/completions` to the end of the endpoint URL when using the `openai` library.

### Include Response Citations

When sending a `POST` request to the `$AGENT_ENDPOINT/api/v1/chat/completions` endpoint, you can view the agent’s retrieval information in the response by setting the following retrieval parameters to `true` in the request body:

- `include_retrieval_info`: Includes the knowledge bases and subsequent files accessed to generate the response.
- `include_functions_info`: Includes a list of functions used to generate the response.
- `include_guardrails_info`: Includes a list of guardrails used to generate the response and the reasons why the guardrails were triggered.

The retrieval object in a response looks like the following:

```js
{
    "retrieval": {
        "retrieved_data": [
            {
                "id": "...",
                "index": "...",
                "page_content": "some text",
                "score": -9549511700,
                "filename": "file name or url",
                "data_source_id": "...",
                "metadata": {...additional metadata for chunk}
            },
        ]
    },
    "guardrails": {
        "triggered_guardrails": [
           { rule_name: "sensitive_data", message: "what trigggered it" }
         ]
    },
    "functions": {
        "called_functions": ["get_weather"]
    },
}
```

## Use Chatbot Interface

To embed the chatbot widget on public sites, [set your agent’s endpoint to public](#set-availability). Setting the endpoint public displays a **CHATBOT** section with an HTML `<script>` element code snippet. You can directly embed the snippet in your application, such as a WordPress or static HTML website, to use the chatbot. The embed code looks like this:

```html
<script
  async
  src="https://<agent-indentifier>.ondigitalocean.app/static/chatbot/widget.js"
  data-agent-id="<agent-data-indentifier>"
  data-chatbot-id="<agent-chatbot-indentifier>"
  data-name="My Chatbot"
  data-primary-color="#031B4E"
  data-secondary-color="#E5E8ED"
  data-button-background-color="#0061EB"
  data-starting-message="Hello! I am an AI agent. How can I help you today?"
  data-logo="https://example.com/your-logo.svg"
></script>
```

You cannot view retrieval information in the chatbot interface.

### Customize the Chatbot

The code snippet contains several parameters that you can customize for your application. For example, customize the chatbot’s appearance and behavior such as the chatbot’s name, colors, logo, and starting message. Embed the code snippet in your application, and then directly modify the parameters in the snippet. For example, to change the chatbot’s name, modify the `data-name` parameter. To add a chatbot logo, upload an image to your website and then set the `data-logo` parameter to the image’s URL. You do not need to treat the `data-agent-id` and `data-chatbot-id` fields as secrets.

Alternatively, in the **CHATBOT** section of the in the control panel, click **Customize** to open the **Customize chatbot design** window and modify the settings.

### Add Allowed Domains

For enhanced security with the chatbot, we strongly recommend that you add allowed domains. Doing so ensures that your agent endpoint can only be reached through those approved domains.

In the **Chatbot security** section of the **Customize chatbot design** window, add the domains where you want to embed this chatbot. You can add multiple domains, separated by commas.

![Field for adding allowed domains](https://docs.digitalocean.com/screenshots/ai-platform/chatbot-security-domains.093d106773472626fdfc91ac98f2435da3064814a465d925e3b44628b946a935.png)

Leaving this field blank means your chatbot code can be embedded on any website.

## Provide Agent Feedback

You can give thumbs up/thumbs down feedback on the quality and helpfulness of the agent’s responses using one of the following:

- End users can give feedback when interacting with agents through [the chatbot interface](#use-chatbot-interface).
- Agent developers can provide feedback:
  - When [testing their agents in the agent playground](https://docs.digitalocean.com/products/ai-platform/how-to/test-agents/index.html.md#provide-agent-feedback).
  - Directly in the agent’s log stream traces, as described in [View Traces, Conversation Logs, and Insights](https://docs.digitalocean.com/products/ai-platform/how-to/view-agent-observability/index.html.md#conversation).

After selecting a thumb rating, you can optionally provide a reason, such as `Helpful`, `Inaccurate`, or `Other` to specify your own reason for the rating.

Both end user and internal feedback collected from agent testing in the playground are stored in the agent’s log stream traces. To view the recent feedback in the [control panel](https://cloud.digitalocean.com), click **Agent Platform** under **INFERENCE** in the left menu. In the **Workspaces** tab, select the workspace that contains the agent and then select the agent. In the agent’s **Observability** tab, scroll to the **Traces and conversation logs** section and click **View log stream** to open the log stream in a new window. The feedback appears in the **Traces** tab of the log stream.

![Log stream traces screen showing a message tree for an agent traces, with agent response and feedback ratings on the right.](https://docs.digitalocean.com/screenshots/ai-platform/agent-feedback-traces.14a048c8d8b91c42794bea1e548e6da1ae414649ae0b784b77e4dc808faffb79.png)

The user-provided thumb rating and reason appear in the **User Feedback** columns, while internal feedback appears in the **Internal Feedback** columns of the trace details. You can add, remove, or reorder columns by clicking the icon to the left of the **Sessions** tab and making the changes in the window that opens.

## Use Agent After Updating to Another Model

If you change the foundation model at any time after [creating the agent](https://docs.digitalocean.com/products/ai-platform/how-to/create-agents/index.html.md), you must take the following steps:

- **Update the model ID in your CLI/API calls, serverless inference requests, and ADK code**: Update the model ID parameter in your code to the new model ID.
- **Review prompt logic**: While new models are largely backward compatible, we recommend [reviewing your system prompts](https://docs.digitalocean.com/products/ai-platform/concepts/prompts/index.html.md), as the new model follows instructions more precisely. You may need to adjust your prompts to get the desired response format.
- **Test agent**: Run parallel tests to validate output consistency before the retirement date using the [Agent Playground](https://docs.digitalocean.com/products/ai-platform/how-to/test-agents/index.html.md).

You can [roll back to a previous version of your agent](https://docs.digitalocean.com/products/ai-platform/how-to/manage-agent-versions/index.html.md) if you encounter any issues with the new model.
