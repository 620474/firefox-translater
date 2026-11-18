# Privacy notice — AI Article Reader

AI Article Reader is a bring-your-own-key (BYOK) browser extension.
This notice explains data handling for both direct API and optional NestJS operation.

## Information transmitted

- **Website content:** when you choose Translate or Summarize, the extension
  sends relevant article text to the AI provider selected in settings: Google
  Gemini, DeepSeek, or OpenAI. Translation results are returned and displayed in
  the current page. A short excerpt context may be included to preserve meaning.
- **Authentication information:** the API key you enter for the selected AI
  provider is sent to that provider for authentication. If you explicitly enable
  the optional self-hosted NestJS gateway, the key and article content first pass
  through that gateway and then on to the provider.
- **No analytics or telemetry:** the extension code does not send analytics,
  crash reporting, or usage tracking to its developer. The developer has no
  dedicated account system or built-in logging service.

## Local storage

API keys, model choices, display preferences, and cached translations are stored
locally in the browser's extension storage. The extension does not sync this
information to a developer-operated backend. Browser extension storage is **not
an encrypted secrets vault**.

## When data is transmitted

Merely loading a webpage does not send its article to an AI API. Content is
transmitted after the user starts a translation or summarization. The optional
"Get models" button transmits the relevant API key to retrieve available models.
The extension can read website content on websites where it is enabled, and
only sends article text to the selected AI provider on a user action.

## Third-party processing

The AI provider's own service terms, privacy practices, retention and usage
rules apply to requests submitted using your API key. Do not process sensitive
content unless you are comfortable sending it to that provider.

## Data deletion

You can delete stored API keys from extension settings and remove cached data by
uninstalling the extension and clearing its local storage. Uninstalling does not
delete information already processed by an external AI provider.

## Contact / repository

Source and issue tracker:
https://github.com/620474/firefox-translater
