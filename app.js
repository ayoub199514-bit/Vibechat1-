import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp, doc, setDoc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

// إعدادات مشروعك كما أرسلتها. لا تضف أسرار الدفع إلى هذا الملف.
const firebaseConfig = {
  apiKey: "AIzaSyAQm8yQaxVjA4BTrH48XCc3cH2znM3TCEo",
  authDomain: "vibechat1-85514.firebaseapp.com",
  projectId: "vibechat1-85514",
  storageBucket: "vibechat1-85514.firebasestorage.app",
  messagingSenderId: "1038700177785",
  appId: "1:1038700177785:web:ad0ec51e954ecb4f03e7a8",
  measurementId: "G-HDWPM800ZQ"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const authPanel = $("authPanel"), appPanel = $("appPanel"), adminPanel = $("adminPanel");
let mode = "login", currentUser = null, stopMessages = null, stopUsers = null;
let isAdmin = false;

function show(el, yes) { el.classList.toggle("hidden", !yes); }
function safeText(value) { return String(value ?? ""); }
function setAuthMode(next) {
  mode = next;
  const register = mode === "register";
  $("authTitle").textContent = register ? "أنشئ حسابك" : "مرحبًا بك في VibeChat";
  $("authSubmit").textContent = register ? "إنشاء الحساب" : "تسجيل الدخول";
  $("toggleAuth").textContent = register ? "لديك حساب؟ سجّل الدخول" : "ليس لديك حساب؟ أنشئ حسابًا";
  show($("displayName"), register); show($("nameLabel"), register);
  $("password").autocomplete = register ? "new-password" : "current-password";
  $("authError").textContent = "";
}
$("toggleAuth").addEventListener("click", () => setAuthMode(mode === "login" ? "register" : "login"));

$("authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("authError").textContent = "";
  const email = $("email").value.trim();
  const password = $("password").value;
  const name = $("displayName").value.trim();
  const submit = $("authSubmit");
  submit.disabled = true; submit.textContent = "يرجى الانتظار…";
  try {
    if (mode === "register") {
      if (!name) throw new Error("اكتب اسم العرض أولًا.");
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName: name });
      await setDoc(doc(db, "users", credential.user.uid), {
        uid: credential.user.uid, displayName: name, email,
        createdAt: serverTimestamp(), plan: "free", subscriptionStatus: "inactive"
      });
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) {
    $("authError").textContent = friendlyError(error);
  } finally {
    submit.disabled = false;
    submit.textContent = mode === "register" ? "إنشاء الحساب" : "تسجيل الدخول";
  }
});

function friendlyError(error) {
  const code = error?.code || "";
  const map = {
    "auth/email-already-in-use": "هذا البريد مستخدم بالفعل.",
    "auth/invalid-email": "صيغة البريد الإلكتروني غير صحيحة.",
    "auth/weak-password": "كلمة المرور ضعيفة؛ استخدم 6 أحرف على الأقل.",
    "auth/invalid-credential": "البريد أو كلمة المرور غير صحيحة.",
    "auth/too-many-requests": "محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.",
    "auth/operation-not-allowed": "فعّل تسجيل الدخول بالبريد وكلمة المرور من Firebase Authentication.",
    "permission-denied": "رفضت قواعد Firestore العملية. تأكد من نشر firestore.rules وضبط UID المالك.",
    "unavailable": "تعذر الاتصال بقاعدة البيانات. تحقق من الإنترنت وإعدادات Firebase."
  };
  return map[code] || error?.message || "حدث خطأ غير متوقع.";
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  $("status").textContent = user ? "متصل" : "غير متصل";
  show($("logoutBtn"), !!user);
  show(authPanel, !user);
  show(appPanel, !!user);
  if (!user) {
    show(adminPanel, false);
    if (stopMessages) stopMessages();
    if (stopUsers) stopUsers();
    return;
  }
  $("currentName").textContent = user.displayName || user.email || "مستخدم";
  $("currentEmail").textContent = user.email || "";
  $("avatar").textContent = (user.displayName || user.email || "V").trim().charAt(0).toUpperCase();
  try {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      await setDoc(userRef, { uid:user.uid, displayName:user.displayName || "مستخدم", email:user.email || "", createdAt:serverTimestamp(), plan:"free", subscriptionStatus:"inactive" }, { merge:true });
    }
    // لوحة الإدارة لا تظهر إلا للمستخدم الذي تطابق UID المالك في firestore.rules.
    // ضع UID المالك في ADMIN_UID بعد أول تسجيل دخول، ثم انشر القواعد.
    isAdmin = user.uid === ADMIN_UID;
    show($("adminBtn"), isAdmin);
  } catch (error) {
    $("chatError").textContent = friendlyError(error);
  }
  listenMessages();
});

const ADMIN_UID = "REPLACE_WITH_OWNER_AUTH_UID";

function listenMessages() {
  if (stopMessages) stopMessages();
  const q = query(collection(db, "messages"), orderBy("createdAt", "asc"), limit(100));
  stopMessages = onSnapshot(q, (snapshot) => {
    const container = $("messages");
    container.replaceChildren();
    if (snapshot.empty) {
      const empty = document.createElement("div");
      empty.className = "empty-state"; empty.textContent = "لا توجد رسائل بعد. ابدأ المحادثة!";
      container.appendChild(empty);
    }
    snapshot.forEach((item) => {
      const data = item.data();
      const wrap = document.createElement("article");
      wrap.className = "message" + (data.uid === currentUser?.uid ? " mine" : "");
      const meta = document.createElement("div"); meta.className = "message-meta";
      const name = document.createElement("strong"); name.textContent = safeText(data.displayName || "مستخدم");
      const time = document.createElement("span");
      time.textContent = data.createdAt?.toDate ? data.createdAt.toDate().toLocaleString() : "الآن";
      const body = document.createElement("div"); body.className = "message-body"; body.textContent = safeText(data.text);
      meta.append(name, time); wrap.append(meta, body); container.appendChild(wrap);
    });
    container.scrollTop = container.scrollHeight;
    $("messageCount").textContent = String(snapshot.size);
  }, (error) => { $("chatError").textContent = friendlyError(error); });
}

$("messageForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) return;
  const input = $("messageInput"), text = input.value.trim();
  if (!text) return;
  $("chatError").textContent = "";
  const send = event.submitter || $("messageForm").querySelector("button");
  send.disabled = true;
  try {
    await addDoc(collection(db, "messages"), {
      uid: currentUser.uid, displayName: currentUser.displayName || currentUser.email || "مستخدم",
      text, createdAt: serverTimestamp()
    });
    input.value = "";
  } catch (error) { $("chatError").textContent = friendlyError(error); }
  finally { send.disabled = false; input.focus(); }
});

$("logoutBtn").addEventListener("click", async () => { await signOut(auth); });
$("adminBtn").addEventListener("click", async () => {
  if (!currentUser || currentUser.uid !== ADMIN_UID) return;
  show(appPanel, false); show(adminPanel, true);
  $("usersTable").innerHTML = '<tr><td colspan="4">جارٍ التحميل…</td></tr>';
  try {
    const snapshot = await getDocs(query(collection(db, "users"), limit(200)));
    $("userCount").textContent = String(snapshot.size);
    const tbody = $("usersTable"); tbody.replaceChildren();
    snapshot.forEach((item) => {
      const u = item.data(), tr = document.createElement("tr");
      [u.displayName || "—", u.email || "—", u.uid || item.id, u.createdAt?.toDate ? u.createdAt.toDate().toLocaleDateString() : "—"].forEach((value) => {
        const td = document.createElement("td"); td.textContent = safeText(value); tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  } catch (error) { $("usersTable").innerHTML = `<tr><td colspan="4">${safeText(friendlyError(error))}</td></tr>`; }
});
$("closeAdmin").addEventListener("click", () => { show(adminPanel, false); show(appPanel, true); });
