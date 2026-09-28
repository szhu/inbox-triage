// Runs in the browser, inside Apps Script's sandboxed iframe — a completely
// different runtime from src/server/*.ts (which runs server-side with access
// to GmailApp etc., and shares nothing with this file at runtime). Talks to
// the server only through google.script.run.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { sanitizeHtmlToString } from "./sanitizeHtml";

interface ScriptRunner {
  withSuccessHandler(callback: (value: any) => void): ScriptRunner;
  withFailureHandler(callback: (error: Error) => void): ScriptRunner;
  [serverFunction: string]: any;
}
declare const google: { script: { run: ScriptRunner } };

const ICONS = {
  archive:
    '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="3" fill="none" stroke="currentColor"/><path d="M3 6h10v7H3z" fill="none" stroke="currentColor"/><path d="M6.5 8.5h3M8 8.5v3M6.5 10l1.5 1.5L9.5 10" fill="none" stroke="currentColor"/></svg>',
  unarchive:
    '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="3" fill="none" stroke="currentColor"/><path d="M3 6h10v7H3z" fill="currentColor"/><path d="M6.5 11.5h3M8 11.5v-3M6.5 10l1.5-1.5L9.5 10" fill="none" stroke="white"/></svg>',
  unread:
    '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" fill="currentColor"/></svg>',
  read: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" fill="none" stroke="currentColor"/></svg>',
  refresh:
    '<svg viewBox="0 0 16 16"><path d="M3 8a5 5 0 0 1 8.5-3.5M13 8a5 5 0 0 1-8.5 3.5" fill="none" stroke="currentColor"/><path d="M11 2v3h-3M5 14v-3h3" fill="none" stroke="currentColor"/></svg>',
  star: '<svg viewBox="0 0 16 16"><path d="M8 2l1.8 3.9 4.2.5-3.1 3 .8 4.3L8 11.6 4.3 13.7l.8-4.3-3.1-3 4.2-.5z" fill="currentColor"/></svg>',
  unstar:
    '<svg viewBox="0 0 16 16"><path d="M8 2l1.8 3.9 4.2.5-3.1 3 .8 4.3L8 11.6 4.3 13.7l.8-4.3-3.1-3 4.2-.5z" fill="none" stroke="currentColor"/></svg>',
  checked:
    '<svg viewBox="0 0 16 16"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  unchecked:
    '<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="currentColor"/></svg>',
};

const PAGE_SIZE = 50;

interface AppState {
  allThreads: any[];
  setAllThreads: React.Dispatch<React.SetStateAction<any[]>>;
  reachedEndOfInbox: boolean;
  setReachedEndOfInbox: (value: boolean) => void;
  loadingMore: boolean;
  setLoadingMore: (value: boolean) => void;
  refreshing: boolean;
  selectedGroup: string | null;
  setSelectedGroup: (group: string | null) => void;
  openThreadId: string | null;
  setOpenThreadId: (threadId: string | null) => void;
  refresh: () => void;
  markReadOnOpen: boolean;
  setMarkReadOnOpen: (value: boolean) => void;
}

const AppContext = createContext<AppState | null>(null);

function useAppContext(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext used outside AppProvider");
  return ctx;
}

function AppProvider({ children }: { children: React.ReactNode }) {
  const [allThreads, setAllThreads] = useState<any[]>([]);
  const [reachedEndOfInbox, setReachedEndOfInbox] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [markReadOnOpen, setMarkReadOnOpen] = useState(false);

  const refresh = useCallback(() => {
    setReachedEndOfInbox(false);
    setRefreshing(true);
    google.script.run
      .withSuccessHandler((threads: any[]) => {
        setRefreshing(false);
        setAllThreads(threads);
        setReachedEndOfInbox(threads.length < PAGE_SIZE);
      })
      .withFailureHandler((error: Error) => {
        setRefreshing(false);
        fail(error);
      })
      .listInboxThreads(0);
  }, []);

  useEffect(refresh, [refresh]);

  return (
    <AppContext.Provider
      value={{
        allThreads,
        setAllThreads,
        reachedEndOfInbox,
        setReachedEndOfInbox,
        loadingMore,
        setLoadingMore,
        refreshing,
        selectedGroup,
        setSelectedGroup,
        openThreadId,
        setOpenThreadId,
        refresh,
        markReadOnOpen,
        setMarkReadOnOpen,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

// A cache-and-dedupe layer in front of server calls whose results never go
// stale for a given key (e.g. a thread's messages, which are immutable once
// sent). A successful result is cached forever; a call already in flight for
// the same key is joined instead of firing a duplicate request.
const callCache = new Map<string, any>();
const callsInFlight = new Map<string, Array<(result: any) => void>>();

function cachedCall(
  key: string,
  run: (onSuccess: (result: any) => void) => void,
  onSuccess: (result: any) => void,
) {
  if (callCache.has(key)) {
    onSuccess(callCache.get(key));
    return;
  }
  const waiters = callsInFlight.get(key);
  if (waiters) {
    waiters.push(onSuccess);
    return;
  }
  callsInFlight.set(key, [onSuccess]);
  run((result) => {
    callCache.set(key, result);
    const toNotify = callsInFlight.get(key) ?? [];
    callsInFlight.delete(key);
    for (const notify of toNotify) notify(result);
  });
}

function fetchThreadMessages(
  threadId: string,
  onSuccess: (messages: any[]) => void,
) {
  cachedCall(
    `getThreadMessages:${threadId}`,
    (settle) =>
      google.script.run
        .withSuccessHandler(settle)
        .withFailureHandler(fail)
        .getThreadMessages(threadId),
    onSuccess,
  );
}

// Bumped every time a different sender is selected, so an in-flight
// background prefetch from a previously selected sender can tell it's stale
// and stop issuing further fetches instead of racing the new selection.
let senderPrefetchGeneration = 0;

// Prefetches (and caches) messages for every thread in a sender's group in
// the background, one at a time, so opening any of them afterward is
// instant. Stops as soon as a different sender is selected.
function prefetchSenderMessages(
  group: string,
  generation: number,
  allThreads: any[],
) {
  const threadIds = allThreads
    .filter((t) => t.senderGroup === group)
    .map((t) => t.id)
    .filter((id) => !callCache.has(`getThreadMessages:${id}`));
  let i = 0;
  const next = () => {
    if (generation !== senderPrefetchGeneration) return;
    if (i >= threadIds.length) return;
    const threadId = threadIds[i++];
    fetchThreadMessages(threadId, () => {
      if (generation !== senderPrefetchGeneration) return;
      next();
    });
  };
  next();
}

declare const PAGE_DATA: { appUrl: string };

// Shows who sent the most recent thread in the group, plus how many other
// distinct people/senders have also sent one -- e.g. "Aria Kovalovich +2"
// -- rather than an arbitrary single name, since a sender group commonly
// bundles several distinct senders (a mailing list's many posters, or a
// domain like google.com covering several different Google products/teams).
// The "+N" part is returned separately so it can be styled less prominently
// than the name itself.
function senderGroupSummary(threads: any[]): {
  name: string;
  othersCount: number;
} {
  const byRecency = [...threads].sort((a, b) => b.date.localeCompare(a.date));
  // Prefer the most recent thread that actually has a display name over a
  // merely-more-recent one that doesn't, so the headline name isn't a raw,
  // hard-to-read address like "noreply-apps-scripts-notifications@google.com"
  // just because it happens to be the latest.
  const mostRecent = byRecency.find((t) => t.senderName) ?? byRecency[0];
  const recentName = mostRecent.senderName || mostRecent.sender;
  const names = threads.map((t) => t.senderName || t.sender);
  const others = new Set(names.filter((n) => n !== recentName));

  // --- Shared-phrase override (remove this block to revert to always
  // showing "<most recent sender> +N others") ---
  // When every sender's display name shares a contiguous phrase (e.g.
  // "American Airlines AAdvantage" and "American Airlines Cargo" both start
  // with "American Airlines"), that phrase alone is a better headline than
  // any one sender's name plus a "+N" -- it's the actual reason these are
  // grouped together, not an arbitrary pick.
  const wordsOf = (name: string) => name.split(/\s+/).filter(Boolean);
  const containsWordSequence = (haystack: string[], needle: string[]) => {
    for (let i = 0; i <= haystack.length - needle.length; i++) {
      if (
        needle.every(
          (word, j) => haystack[i + j].toLowerCase() === word.toLowerCase(),
        )
      ) {
        return true;
      }
    }
    return false;
  };
  if (names.length > 0) {
    const firstWords = wordsOf(names[0]);
    const otherWordLists = names.slice(1).map(wordsOf);
    let sharedPhrase = "";
    // Try every contiguous span of the first name's words, longest first, and
    // keep the longest one that's present in every other name too.
    for (let len = firstWords.length; len >= 1 && !sharedPhrase; len--) {
      for (let start = 0; start + len <= firstWords.length; start++) {
        const span = firstWords.slice(start, start + len);
        if (
          otherWordLists.every((words) => containsWordSequence(words, span))
        ) {
          sharedPhrase = span.join(" ");
          break;
        }
      }
    }
    if (sharedPhrase) {
      return { name: sharedPhrase, othersCount: 0 };
    }
  }
  // --- end shared-phrase override ---

  return { name: recentName, othersCount: others.size };
}

// Set right before navigating away (e.g. the double-click reload), so
// fail() can ignore errors from requests the navigation aborted in flight
// instead of alerting on a spurious error the user didn't cause.
let navigatingAway = false;

function fail(error: Error) {
  if (navigatingAway) return;
  alert(
    "Error: " +
      (error instanceof Error ? error.message : JSON.stringify(error)),
  );
}

function IconButton({
  icon,
  title,
  onClick,
  pending,
}: {
  icon: keyof typeof ICONS;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  pending?: boolean;
}) {
  return (
    <button
      className={"icon-btn" + (pending ? " pending" : "")}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      dangerouslySetInnerHTML={{ __html: ICONS[icon] }}
    />
  );
}

function Topbar() {
  const { refreshing, refresh, markReadOnOpen, setMarkReadOnOpen } =
    useAppContext();
  return (
    <div id="topbar">
      <h1
        id="app-title"
        onDoubleClick={() => {
          navigatingAway = true;
          document.body.style.opacity = "0";
          window.top!.location.href = PAGE_DATA.appUrl;
        }}
      >
        Inbox Triage
      </h1>
      <button
        className="toggle-btn"
        onClick={() => setMarkReadOnOpen(!markReadOnOpen)}
      >
        <span
          className="toggle-btn-icon"
          dangerouslySetInnerHTML={{
            __html: ICONS[markReadOnOpen ? "checked" : "unchecked"],
          }}
        />
        Mark Read
      </button>
      <IconButton
        icon="refresh"
        title="Refresh"
        pending={refreshing}
        onClick={refresh}
      />
    </div>
  );
}

function SenderRow({ group, threads }: { group: string; threads: any[] }) {
  const {
    selectedGroup,
    setSelectedGroup,
    openThreadId,
    setOpenThreadId,
    setAllThreads,
  } = useAppContext();
  const [pending, setPending] = useState(false);
  const unread = threads.filter((t) => t.isUnread).length;
  const isMailingList = threads.some((t) => t.isMailingList);
  const secondLine = isMailingList ? threads[0].listId : group;
  const { name, othersCount } = senderGroupSummary(threads);
  const archived = threads.every((t) => t.archived);

  function archiveSender() {
    const toArchive = threads.filter((t) => !t.archived);
    setPending(true);
    google.script.run
      .withSuccessHandler(() => setPending(false))
      .withFailureHandler((error: Error) => {
        setPending(false);
        fail(error);
      })
      .archiveThreads(toArchive.map((t) => t.id));
    const toArchiveIds = new Set(toArchive.map((t) => t.id));
    setAllThreads((all) =>
      all.map((t) => (toArchiveIds.has(t.id) ? { ...t, archived: true } : t)),
    );
  }

  return (
    <div
      className={
        "sender-row" +
        (selectedGroup === group ? " selected" : "") +
        (archived ? " archived" : "")
      }
      onClick={() => {
        setSelectedGroup(group);
        // A sender with just one thread has nothing to pick between -- open
        // it immediately instead of making that a required extra click.
        // Otherwise, close whatever was open if it's not one of this
        // sender's threads, so switching senders doesn't leave a stale
        // thread's messages rendered under the new sender's rows.
        setOpenThreadId(
          threads.length === 1
            ? threads[0].id
            : threads.some((t) => t.id === openThreadId)
              ? openThreadId
              : null,
        );
      }}
    >
      <span className="sender-text">
        <span className="sender-display-name">
          {name || group}
          {othersCount ? (
            <span className="sender-others-count"> +{othersCount}</span>
          ) : (
            ""
          )}
        </span>
        <span className="sender-name">{secondLine}</span>
      </span>
      <span className="unread-count">{unread ? String(unread) : ""}</span>
      <IconButton
        icon="archive"
        title="Archive all"
        pending={pending}
        onClick={archiveSender}
      />
    </div>
  );
}

function SenderList() {
  const { allThreads, selectedGroup, setSelectedGroup } = useAppContext();
  const groups = [...new Set(allThreads.map((t) => t.senderGroup))];

  useEffect(() => {
    if (selectedGroup && groups.includes(selectedGroup)) return;
    if (groups.length > 0) setSelectedGroup(groups[0]);
  }, [groups.join(",")]);

  useEffect(() => {
    if (!selectedGroup) return;
    senderPrefetchGeneration++;
    prefetchSenderMessages(selectedGroup, senderPrefetchGeneration, allThreads);
  }, [selectedGroup]);

  return (
    <div id="senders">
      {groups.map((group) => (
        <SenderRow
          key={group}
          group={group}
          threads={allThreads.filter((t) => t.senderGroup === group)}
        />
      ))}
    </div>
  );
}

function Row({ t }: { t: any }) {
  const {
    selectedGroup,
    openThreadId,
    setOpenThreadId,
    setAllThreads,
    markReadOnOpen,
  } = useAppContext();
  const [pendingAction, setPendingAction] = useState<
    "archive" | "read" | "star" | null
  >(null);
  const isOpen = openThreadId === t.id;
  const hidden = selectedGroup !== null && t.senderGroup !== selectedGroup;

  function archiveOne() {
    const nowArchived = !t.archived;
    setPendingAction("archive");
    google.script.run
      .withSuccessHandler(() => setPendingAction(null))
      .withFailureHandler((error: Error) => {
        setPendingAction(null);
        fail(error);
      })
      .setThreadArchived(t.id, nowArchived);
    setAllThreads((all) =>
      all.map((row) =>
        row.id === t.id ? { ...row, archived: nowArchived } : row,
      ),
    );
  }

  function toggleThreadRead() {
    const nowRead = t.isUnread;
    setPendingAction("read");
    google.script.run
      .withSuccessHandler(() => setPendingAction(null))
      .withFailureHandler((error: Error) => {
        setPendingAction(null);
        fail(error);
      })
      .markThreadRead(t.id, nowRead);
    setAllThreads((all) =>
      all.map((row) =>
        row.id === t.id ? { ...row, isUnread: !nowRead } : row,
      ),
    );
  }

  function markAsReadSilently() {
    google.script.run.withFailureHandler(fail).markThreadRead(t.id, true);
    setAllThreads((all) =>
      all.map((row) => (row.id === t.id ? { ...row, isUnread: false } : row)),
    );
  }

  function toggleThreadStarred() {
    const nowStarred = !t.isStarred;
    setPendingAction("star");
    google.script.run
      .withSuccessHandler(() => setPendingAction(null))
      .withFailureHandler((error: Error) => {
        setPendingAction(null);
        fail(error);
      })
      .setThreadStarred(t.id, nowStarred);
    setAllThreads((all) =>
      all.map((row) =>
        row.id === t.id ? { ...row, isStarred: nowStarred } : row,
      ),
    );
  }

  return (
    <>
      <div
        className={
          "row" +
          (hidden ? " hidden-row" : "") +
          (t.archived ? " archived" : "") +
          (isOpen ? " open" : "")
        }
        data-sender-group={t.senderGroup}
        data-thread-id={t.id}
        onClick={() => setOpenThreadId(isOpen ? null : t.id)}
      >
        <span className="cell subject">{t.subject}</span>
        <span className="cell date">
          {new Date(t.date).toLocaleDateString(undefined, {
            month: "numeric",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
        <span className="cell count">{String(t.messageCount)}</span>
        <span className="cell actions">
          <IconButton
            icon={t.archived ? "unarchive" : "archive"}
            title="Archive"
            pending={pendingAction === "archive"}
            onClick={archiveOne}
          />
          <IconButton
            icon={t.isUnread ? "unread" : "read"}
            title="Toggle read"
            pending={pendingAction === "read"}
            onClick={toggleThreadRead}
          />
          <IconButton
            icon={t.isStarred ? "star" : "unstar"}
            title="Toggle star"
            pending={pendingAction === "star"}
            onClick={toggleThreadStarred}
          />
        </span>
      </div>
      {isOpen ? (
        <Messages
          threadId={t.id}
          onLoaded={() => {
            if (markReadOnOpen && t.isUnread) markAsReadSilently();
          }}
        />
      ) : null}
    </>
  );
}

function ThreadRows() {
  const {
    allThreads,
    reachedEndOfInbox,
    loadingMore,
    setLoadingMore,
    setAllThreads,
    setReachedEndOfInbox,
  } = useAppContext();
  const mainRef = useRef<HTMLDivElement>(null);

  const maybeLoadMore = useCallback(() => {
    if (loadingMore || reachedEndOfInbox) return;
    const main = mainRef.current;
    if (!main) return;
    if (main.scrollTop + main.clientHeight < main.scrollHeight - 200) return;
    setLoadingMore(true);
    google.script.run
      .withSuccessHandler((threads: any[]) => {
        setLoadingMore(false);
        setReachedEndOfInbox(threads.length < PAGE_SIZE);
        setAllThreads((all) => {
          const seen = new Set(all.map((t) => t.id));
          return all.concat(threads.filter((t) => !seen.has(t.id)));
        });
      })
      .withFailureHandler((error: Error) => {
        setLoadingMore(false);
        fail(error);
      })
      .listInboxThreads(allThreads.length);
  }, [loadingMore, reachedEndOfInbox, allThreads.length]);

  useEffect(maybeLoadMore, [maybeLoadMore, allThreads]);

  return (
    <div id="main" ref={mainRef} onScroll={maybeLoadMore}>
      <div id="threads" hidden={allThreads.length === 0}>
        <div className="header">
          <span>Subject</span>
          <span>Date</span>
          <span>#</span>
          <span></span>
        </div>
        <div className="rows">
          {allThreads.map((t) => (
            <Row key={t.id} t={t} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Message({ m }: { m: any }) {
  const address = m.from.match(/<([^>]+)>/)?.[1] ?? m.from;
  return (
    <div className="messages">
      <div className="message-header">
        <div className="message-header-row">
          {m.fromName ? (
            <span>
              <span className="message-from-name">{m.fromName}</span>
              {" <" + address + ">"}
            </span>
          ) : (
            <span className="message-from-name">{m.from}</span>
          )}
          <span>{new Date(m.date).toLocaleString()}</span>
        </div>
        {m.to ? (
          <div className="message-header-recipients">To: {m.to}</div>
        ) : null}
        {m.cc ? (
          <div className="message-header-recipients">Cc: {m.cc}</div>
        ) : null}
        {m.bcc ? (
          <div className="message-header-recipients">Bcc: {m.bcc}</div>
        ) : null}
      </div>
      <div
        className="message-body"
        dangerouslySetInnerHTML={{ __html: sanitizeHtmlToString(m.body) }}
      />
    </div>
  );
}

function Messages({
  threadId,
  onLoaded,
}: {
  threadId: string;
  onLoaded: () => void;
}) {
  const [messages, setMessages] = useState<any[] | null>(null);

  useEffect(() => {
    setMessages(null);
    fetchThreadMessages(threadId, setMessages);
  }, [threadId]);

  // Only fires while this component is mounted, i.e. while its thread is
  // still open -- closing the thread before this fires (even if a fetch
  // that was already in flight resolves afterward) means it never does.
  useEffect(() => {
    if (messages !== null) onLoaded();
  }, [messages]);

  if (messages === null) {
    return (
      <div className="row messages-row" data-messages-for={threadId}>
        <div className="cell messages-cell">Loading...</div>
      </div>
    );
  }

  return (
    <div className="row messages-row" data-messages-for={threadId}>
      <div className="cell messages-cell">
        <div>
          <a
            className="open-in-gmail"
            href={
              "https://mail.google.com/mail/?authuser=" +
              messages[0].userEmail +
              "#all/" +
              threadId
            }
            target="_blank"
          >
            Open thread in Gmail
          </a>
        </div>
        {messages.map((m) => (
          <Message key={m.id} m={m} />
        ))}
      </div>
    </div>
  );
}

function App() {
  return (
    <AppProvider>
      <Topbar />
      <div id="body">
        <SenderList />
        <ThreadRows />
      </div>
    </AppProvider>
  );
}

createRoot(document.getElementById("app")!).render(<App />);
