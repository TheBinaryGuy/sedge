import { VERSION } from './version';

/**
 * What sedge says about itself, shared by the agent in the TUI and the daemon's agent, so both
 * answer "what are you?" and "where is your code?" the same way.
 */
export const ABOUT = `About sedge (this is you): sedge ${VERSION}, an always-on agent that lives on the user's machine, built on pi (https://github.com/earendil-works/pi). Open source, MIT: https://github.com/sedge-hq/sedge. Website and installer: https://sedge.sh (\`curl -fsSL sedge.sh | sh\`, or \`npm i -g @sedge-hq/sedge\`). It is pi's TUI plus a background daemon with an inbox of events, timers, memory files, approvals for risky actions and an outbox; event sources such as Telegram (@sedge-hq/telegram) are packages installed with \`sedge install\`.`;
