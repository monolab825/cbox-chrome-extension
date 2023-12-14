import dayjs from 'dayjs';
import { deduplicateArray } from './content/utils';

class storageService {
  static previousLimit = 3;

  static setPreviousTab(tab: chrome.tabs.TabActiveInfo) {
    storageService.listPreviousTabs((previousTabs) => {
      previousTabs?.unshift(tab);
      previousTabs = previousTabs?.slice(0, storageService.previousLimit);
      chrome.storage.local.set({
        previousTab: deduplicateArray(previousTabs),
      });
    });
  }

  static removePreviousTab(tabId: number) {
    storageService.listPreviousTabs((previousTabs) => {
      previousTabs?.splice(
        previousTabs.findIndex((tab) => tab.tabId === tabId),
        1,
      );
      chrome.storage.local.set({
        previousTab: deduplicateArray(previousTabs),
      });
    });
  }

  static listPreviousTabs(
    callback: (tab: chrome.tabs.TabActiveInfo[]) => void,
  ) {
    chrome.storage.local.get('previousTab', (result) => {
      callback(result?.previousTab ?? []);
    });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case 'listTabs':
      chrome.tabs.query({}, (tabs) => {
        sendResponse(tabs);
      });
      chrome.runtime.sendMessage({
        type: 'listTabs',
      });
      break;
    case 'recentTabs':
      storageService.listPreviousTabs((recentTabs) => {
        chrome.tabs.query({}, (tabs) => {
          const tabIds = recentTabs.map((tab) => tab.tabId);
          const filteredTabs = tabs.filter((tab) => tabIds.includes(tab.id!))
          sendResponse(filteredTabs);
        });
      });
      break;
    case 'newTab':
      chrome.tabs.create({
        url: message.url ?? 'https://www.google.com',
      });
      break;
    case 'togglePinTab':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.update(tabs[0].id!, {
          pinned: !tabs[0].pinned,
        });
      });
      break;
    case 'activeTab':
      chrome.windows.update(message.windowId!, {
        focused: true,
      });
      chrome.tabs.update(message.tabId!, {
        active: true,
      });
      break;
    case 'replicateTab':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.create({
          index: tabs[0].index + 100,
          url: tabs[0].url,
          active: true,
        });
      });
      break;
    case 'goBackTab':
      storageService.listPreviousTabs((tabs) => {
        if (!tabs) return;
        const tab = tabs[1];
        chrome.windows.update(tab.windowId, { focused: true });
        chrome.tabs.update(tab.tabId, { active: true });
      });
      break;
    case 'closeLeftTabs':
      let lActiveIndex = -1;
      chrome.tabs.query({ currentWindow: true }, function (tabs) {
        tabs.forEach(function (tab) {
          if (tab.active) {
            lActiveIndex = tab.index;
          }
        });

        tabs.forEach(function (tab) {
          if (tab.index < lActiveIndex && !tab.pinned) {
            chrome.tabs.remove(tab.id!);
          }
        });
      });

      break;
    case 'closeRightTabs':
      let activeIndex = 10000;
      chrome.tabs.query({ currentWindow: true }, function (tabs) {
        tabs.forEach(function (tab) {
          if (tab.active) {
            activeIndex = tab.index;
          }
          if (tab.index > activeIndex) {
            chrome.tabs.remove(tab.id!);
          }
        });
      });
      break;
    case 'closeOtherTabs':
      chrome.tabs.query(
        { active: false, currentWindow: true },
        function (tabs: chrome.tabs.Tab[]) {
          for (let tab of tabs) {
            if (tab.pinned) continue;
            chrome.tabs.remove(tab.id!);
          }
        },
      );
      break;
    case 'newWindow':
      chrome.windows.create({
        focused: true,
      });
      chrome.tabs.getCurrent((tab) => {
        chrome.tabs.update(tab!.id!, {
          active: true,
          url: message?.url ?? 'https://www.google.com',
        });
      });
      break;
    case 'newIncognitoWindow':
      chrome.windows.create({ incognito: true });
      break;
    case 'closeWindow':
      chrome.windows.getCurrent(function (window) {
        chrome.windows.remove(window.id!);
      });
      break;
    case 'closeOtherWindow':
      chrome.windows.getAll(function (windows) {
        for (let window of windows) {
          if (window.focused) continue;
          chrome.windows.remove(window.id!);
        }
      });
      break;
    case 'listHistorys':
      chrome.history.search(
        {
          text: '',
          // maxResults: 1000,
          startTime: dayjs().subtract(1, 'month').unix(),
        },
        (historys) => {
          sendResponse(historys);
        },
      );
      break;
    case 'listBookmarks':
      chrome.bookmarks.getTree((bookmarkTree) => {
        sendResponse(bookmarkTree?.[0]?.children || []);
      });
      break;
  }
  return true;
});

const notifyAllTabs = (message: any) => {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id!, message);
    });
  });
};

const notifyTabUpdate = () => {
  notifyAllTabs({
    type: 'tabUpdated',
  });
};

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.url?.startsWith('chrome://')) {
    chrome.tabs.executeScript(tab.id!, {
      file: 'content_script.js',
    });
  }
  notifyTabUpdate();
});
chrome.tabs.onRemoved.addListener((tabId) => {
  storageService.removePreviousTab(tabId);
  notifyTabUpdate();
});
chrome.tabs.onUpdated.addListener(notifyTabUpdate);
chrome.tabs.onActivated.addListener((activeInfo) => {
  storageService.setPreviousTab(activeInfo);
  notifyAllTabs({
    type: 'tabTabActive',
  });
});

const notifyBookmarkUpdate = () => {
  notifyAllTabs({
    type: 'bookmarkUpdated',
  });
};
chrome.bookmarks.onCreated.addListener(notifyBookmarkUpdate);
chrome.bookmarks.onRemoved.addListener(notifyBookmarkUpdate);
chrome.bookmarks.onMoved.addListener(notifyBookmarkUpdate);
chrome.bookmarks.onChanged.addListener(notifyBookmarkUpdate);

const notifyHistoryUpdate = () => {
  notifyAllTabs({
    type: 'historyUpdated',
  });
};
chrome.history.onVisitRemoved.addListener(notifyHistoryUpdate);
chrome.history.onVisited.addListener(notifyHistoryUpdate);
