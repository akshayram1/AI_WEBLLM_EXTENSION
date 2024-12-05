import "./popup.css";
import {
  MLCEngineInterface,
  InitProgressReport,
  CreateMLCEngine,
  ChatCompletionMessageParam,
  prebuiltAppConfig,
} from "@mlc-ai/web-llm";
import { ProgressBar, Line } from "progressbar.js";

interface ChatMessage {
  role: string;
  content: string;
  timestamp: string;
}

interface ChatHistory {
  messages: ChatMessage[];
  model: string;
}

// Maximum number of chat messages to store (3 pairs of user-assistant messages)
const MAX_CHAT_PAIRS = 3;

function setLabel(id: string, text: string) {
  const label = document.getElementById(id);
  if (label != null) {
    label.innerText = text;
  }
}

function getElementAndCheck(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element == null) {
    throw Error("Cannot find element " + id);
  }
  return element;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Local Storage functions
function saveChatHistory(history: ChatHistory) {
  localStorage.setItem('chatHistory', JSON.stringify(history));
}

function loadChatHistory(): ChatHistory {
  const stored = localStorage.getItem('chatHistory');
  if (stored) {
    return JSON.parse(stored);
  }
  return { messages: [], model: '' };
}

// Function to limit chat history to last 3 pairs
function limitChatHistory(history: ChatHistory): ChatHistory {
  const messages = history.messages;
  if (messages.length > MAX_CHAT_PAIRS * 2) {
    history.messages = messages.slice(-MAX_CHAT_PAIRS * 2);
  }
  return history;
}

// Create chat message element
function createChatMessageElement(message: ChatMessage): HTMLElement {
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${message.role}`;

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.innerHTML = message.content.replace(/\n/g, '<br>');

  const timestampDiv = document.createElement('div');
  timestampDiv.className = 'message-timestamp';
  timestampDiv.textContent = message.timestamp;

  messageDiv.appendChild(contentDiv);
  messageDiv.appendChild(timestampDiv);

  return messageDiv;
}

// Display chat history
function displayChatHistory(history: ChatHistory) {
  const chatContainer = getElementAndCheck('answer');
  chatContainer.innerHTML = '';

  history.messages.forEach(message => {
    const messageElement = createChatMessageElement(message);
    chatContainer.appendChild(messageElement);
  });

  if (history.messages.length > 0) {
    document.getElementById('answerWrapper')!.style.display = 'block';
  }
}

// Initialize variables
const queryInput = getElementAndCheck("query-input")!;
const submitButton = getElementAndCheck("submit-button")!;
const modelName = getElementAndCheck("model-name");

let context = "";
let modelDisplayName = "";
let chatHistory = loadChatHistory();
let apiChatHistory: ChatCompletionMessageParam[] = chatHistory.messages.map(msg => ({
  role: msg.role as "user" | "assistant",
  content: msg.content
}));

fetchPageContents();

(<HTMLButtonElement>submitButton).disabled = true;

let progressBar: ProgressBar = new Line("#loadingContainer", {
  strokeWidth: 4,
  easing: "easeInOut",
  duration: 1400,
  color: "#ffd166",
  trailColor: "#eee",
  trailWidth: 1,
  svgStyle: { width: "100%", height: "100%" },
});

let isLoadingParams = true;
let selectedModel = chatHistory.model || "Qwen2-0.5B-Instruct-q4f16_1-MLC";

// Initialize model selector
const modelSelector = getElementAndCheck("model-selection") as HTMLSelectElement;
prebuiltAppConfig.model_list.forEach((model) => {
  const opt = document.createElement("option");
  opt.value = model.model_id;
  opt.innerHTML = model.model_id;
  opt.selected = model.model_id === selectedModel;
  modelSelector.appendChild(opt);
});

// Initialize engine
let initProgressCallback = (report: InitProgressReport) => {
  setLabel("init-label", report.text);
  progressBar.animate(report.progress, {
    duration: 50,
  });
  if (report.progress == 1.0) {
    enableInputs();
  }
};

modelName.innerText = "Loading initial model...";
const engine: MLCEngineInterface = await CreateMLCEngine(selectedModel, {
  initProgressCallback: initProgressCallback,
});

function enableInputs() {
  if (isLoadingParams) {
    sleep(500);
    isLoadingParams = false;
  }

  const initLabel = document.getElementById("init-label");
  initLabel?.remove();
  const loadingBarContainer = document.getElementById("loadingContainer")!;
  loadingBarContainer?.remove();
  queryInput.focus();

  const modelNameArray = selectedModel.split("-");
  modelDisplayName = modelNameArray[0];
  let j = 1;
  while (j < modelNameArray.length && modelNameArray[j][0] != "q") {
    modelDisplayName = modelDisplayName + "-" + modelNameArray[j];
    j++;
  }

  // Display existing chat history
  if (chatHistory.messages.length > 0) {
    displayChatHistory(chatHistory);
  }
}

let requestInProgress = false;

// Event Listeners
queryInput.addEventListener("keyup", (event) => {
  const shouldEnableButton =
    (<HTMLInputElement>queryInput).value !== "" &&
    !requestInProgress &&
    !isLoadingParams;

  (<HTMLButtonElement>submitButton).disabled = !shouldEnableButton;

  if (event.code === "Enter") {
    event.preventDefault();
    submitButton.click();
  }
});

async function handleClick() {
  requestInProgress = true;
  (<HTMLButtonElement>submitButton).disabled = true;

  const message = (<HTMLInputElement>queryInput).value;
  const timestamp = new Date().toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  let inp = context.length > 0
    ? `Use only the following context when answering the question at the end. Don't use any other knowledge.\n${context}\n\nQuestion: ${message}\n\nHelpful Answer: `
    : message;

  // Add user message to histories
  apiChatHistory.push({ role: "user", content: inp });
  chatHistory.messages.push({ role: "user", content: message, timestamp });

  // Update display with user message
  displayChatHistory(chatHistory);
  document.getElementById("loading-indicator")!.style.display = "block";

  let curMessage = "";
  const completion = await engine.chat.completions.create({
    stream: true,
    messages: apiChatHistory,
  });

  for await (const chunk of completion) {
    const curDelta = chunk.choices[0].delta.content;
    if (curDelta) {
      curMessage += curDelta;
      // Update the last message in real-time
      const tempHistory = {
        ...chatHistory,
        messages: [
          ...chatHistory.messages,
          { role: "assistant", content: curMessage, timestamp }
        ]
      };
      displayChatHistory(tempHistory);
    }
  }

  const response = await engine.getMessage();

  // Add assistant message to histories
  apiChatHistory.push({ role: "assistant", content: response });
  chatHistory.messages.push({ role: "assistant", content: response, timestamp });
  chatHistory.model = selectedModel;

  // Limit chat history to last 3 pairs
  chatHistory = limitChatHistory(chatHistory);
  apiChatHistory = apiChatHistory.slice(-MAX_CHAT_PAIRS * 2);

  // Save to local storage
  saveChatHistory(chatHistory);

  // Final display update
  displayChatHistory(chatHistory);
  document.getElementById("loading-indicator")!.style.display = "none";

  requestInProgress = false;
  (<HTMLButtonElement>submitButton).disabled = false;
  (<HTMLInputElement>queryInput).value = "";
}

submitButton.addEventListener("click", handleClick);

async function handleSelectChange() {
  if (isLoadingParams) return;

  modelName.innerText = "";
  setupLoadingUI();

  isLoadingParams = true;
  (<HTMLButtonElement>submitButton).disabled = true;

  if (requestInProgress) {
    engine.interruptGenerate();
  }

  engine.resetChat();
  apiChatHistory = [];
  chatHistory = { messages: [], model: '' };
  saveChatHistory(chatHistory);
  document.getElementById('answerWrapper')!.style.display = 'none';

  await engine.unload();

  selectedModel = modelSelector.value;
  await reloadEngine();

  requestInProgress = false;
  modelName.innerText = "Now chatting with " + modelDisplayName;
}

function setupLoadingUI() {
  const initLabel = document.createElement("p");
  initLabel.id = "init-label";
  initLabel.innerText = "Initializing model...";

  const loadingContainer = document.createElement("div");
  loadingContainer.id = "loadingContainer";

  const loadingBox = getElementAndCheck("loadingBox");
  loadingBox.appendChild(initLabel);
  loadingBox.appendChild(loadingContainer);

  progressBar = new Line("#loadingContainer", {
    strokeWidth: 4,
    easing: "easeInOut",
    duration: 1400,
    color: "#ffd166",
    trailColor: "#eee",
    trailWidth: 1,
    svgStyle: { width: "100%", height: "100%" },
  });
}

async function reloadEngine() {
  initProgressCallback = (report: InitProgressReport) => {
    setLabel("init-label", report.text);
    progressBar.animate(report.progress, {
      duration: 50,
    });
    if (report.progress == 1.0) {
      enableInputs();
    }
  };

  engine.setInitProgressCallback(initProgressCallback);
  modelName.innerText = "Reloading with new model...";
  await engine.reload(selectedModel);
}

modelSelector.addEventListener("change", handleSelectChange);

function fetchPageContents() {
  chrome.tabs.query({ currentWindow: true, active: true }, function (tabs) {
    const port = chrome.tabs.connect(tabs[0].id!, { name: "channelName" });
    port.postMessage({});
    port.onMessage.addListener(function (msg) {
      console.log("Page contents:", msg.contents);
      context = msg.contents;
    });
  });
}