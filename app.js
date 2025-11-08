// --- 1. CONFIGURATION ---
// (Paste your Supabase API keys here)

const SUPABASE_URL = 'https://whxarxnfwaeynebulpnw.supabase.co'; // <-- Paste your URL here
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndoeGFyeG5md2FleW5lYnVscG53Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyNjExMTYsImV4cCI6MjA3NzgzNzExNn0.JXOCioN8hrItBVlA38x2PjOE_xgSPqMSAy5N82kOYQg'; // <-- Paste your Anon Key here

// Initialize the Supabase client
const { createClient } = supabase;
const _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- 2. DOM ELEMENTS ---
// (Get references to all the HTML elements we need to work with)

// Auth elements
const authContainer = document.getElementById('auth-container');
const signupForm = document.getElementById('signup-form');
const loginForm = document.getElementById('login-form');
const authError = document.getElementById('auth-error');

// App elements
const appContainer = document.getElementById('app-container');
const logoutButton = document.getElementById('logout-button');
const uploadStatus = document.getElementById('upload-status');
const fileInput = document.getElementById('file-input');
const uploadButton = document.getElementById('upload-button');
const fileList = document.getElementById('file-list');

// --- 3. AUTHENTICATION ---
// (Handle user sign up, login, and logout)

// Sign up a new user
signupForm.addEventListener('submit', async (e) => {
  e.preventDefault(); // Prevent the form from refreshing the page
  const email = document.getElementById('signup-email').value;
  const password = document.getElementById('signup-password').value;

  const { data, error } = await _supabase.auth.signUp({ email, password });

  if (error) {
    authError.textContent = `Sign up error: ${error.message}`;
  } else {
    authError.textContent = 'Sign up successful! Please check your email to verify.';
    signupForm.reset();
  }
});

// Log in an existing user
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  const { data, error } = await _supabase.auth.signInWithPassword({ email, password });

  if (error) {
    authError.textContent = `Login error: ${error.message}`;
  } else {
    // Login successful, setup the app
    authError.textContent = '';
    loginForm.reset();
    await setupApp(data.user);
  }
});

// Log out the current user
logoutButton.addEventListener('click', async () => {
  const { error } = await _supabase.auth.signOut();
  if (error) {
    alert(`Logout error: ${error.message}`);
  } else {
    // Show auth, hide app
    authContainer.style.display = 'block';
    appContainer.style.display = 'none';
    fileList.innerHTML = ''; // Clear the file list on logout
  }
});

// --- 4. APP SETUP & FILE MANAGEMENT ---

// This function runs when the user logs in
async function setupApp(user) {
  // Hide auth, show app
  authContainer.style.display = 'none';
  appContainer.style.display = 'block';

  // Load initial files for the user
  await loadUserFiles(user.id);

  // Set up a real-time listener for file changes
  // This is the "great feature" you wanted
  listenForFileChanges(user.id);
}

// Check for existing session when the page loads
async function checkSession() {
  const { data } = await _supabase.auth.getSession();
  if (data.session) {
    await setupApp(data.session.user);
  } else {
    // No user logged in, show the auth forms
    authContainer.style.display = 'block';
    appContainer.style.display = 'none';
  }
}

// Run the session check when the script loads
checkSession();

// --- 5. FILE OPERATIONS (UPLOAD, LOAD, DELETE) ---

// Upload a file
uploadButton.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) {
    uploadStatus.textContent = 'Please select a file to upload.';
    return;
  }

  // Get the currently logged-in user
  const {
    data: { user },
  } = await _supabase.auth.getUser();
  if (!user) {
    uploadStatus.textContent = 'Error: You must be logged in to upload.';
    return;
  }

  uploadStatus.textContent = 'Uploading...';

  // 1. Upload the file to Supabase Storage
  // We create a unique path for the file: user_id/file_name
  const filePath = `${user.id}/${file.name}`;
  const { error: storageError } = await _supabase.storage.from('user_files').upload(filePath, file);

  if (storageError) {
    uploadStatus.textContent = `Storage error: ${storageError.message}`;
    console.error(storageError);
    return;
  }

  // 2. Add the file metadata to our 'files' database table
  const { error: dbError } = await _supabase.from('files').insert({
    user_id: user.id,
    file_name: file.name,
    file_path: filePath,
    file_size: file.size,
  });

  if (dbError) {
    uploadStatus.textContent = `Database error: ${dbError.message}`;
    console.error(dbError);
  } else {
    uploadStatus.textContent = 'Upload successful!';
    fileInput.value = ''; // Clear the file input
    // The real-time listener will automatically add the file to the UI
  }
});

// Load all files for the current user from the database
async function loadUserFiles(userId) {
  const { data, error } = await _supabase
    .from('files')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading files:', error.message);
  } else {
    displayFiles(data);
  }
}

// Display the files in the HTML list
function displayFiles(files) {
  fileList.innerHTML = ''; // Clear the list first

  if (files.length === 0) {
    fileList.innerHTML = '<li>No files uploaded yet.</li>';
    return;
  }

  files.forEach((file) => {
    const li = document.createElement('li');

    // Format file size (e.g., 1024 bytes -> 1 KB)
    const fileSize = (file.file_size / 1024).toFixed(2);

    li.innerHTML = `
      <span class="file-info">${file.file_name} (${fileSize} KB)</span>
      <div class="file-actions">
        <button class="download-btn" data-path="${file.file_path}">Download</button>
        <button class="delete-btn" data-id="${file.id}" data-path="${file.file_path}">Delete</button>
      </div>
    `;
    fileList.appendChild(li);
  });
}

// --- 6. REAL-TIME LISTENER & EVENT HANDLERS (DELETE/DOWNLOAD) ---

// Listen for inserts or deletes on the 'files' table
function listenForFileChanges(userId) {
  _supabase
    .channel('public:files')
    .on(
      'postgres_changes',
      {
        event: '*', // Listen to INSERT, UPDATE, DELETE
        schema: 'public',
        table: 'files',
        filter: `user_id=eq.${userId}`, // Only changes to this user's files
      },
      (payload) => {
        console.log('Change received!', payload);
        // Reload all files to show the change
        loadUserFiles(userId);
      }
    )
    .subscribe();
}

// Handle Download and Delete button clicks
fileList.addEventListener('click', async (e) => {
  const user = (await _supabase.auth.getUser()).data.user;

  // --- Handle Delete ---
  if (e.target.classList.contains('delete-btn')) {
    const fileId = e.target.dataset.id;
    const filePath = e.target.dataset.path;

    if (!confirm('Are you sure you want to delete this file?')) return;

    // 1. Delete from Storage
    const { error: storageError } = await _supabase.storage.from('user_files').remove([filePath]);

    // 2. Delete from Database
    const { error: dbError } = await _supabase.from('files').delete().eq('id', fileId);

    if (storageError || dbError) {
      alert('Error deleting file: ' + (storageError?.message || dbError?.message));
    } else {
      // Real-time listener will handle the UI update
    }
  }

  // --- Handle Download ---
  if (e.target.classList.contains('download-btn')) {
    const filePath = e.target.dataset.path;

    // Get a temporary signed URL to download the file
    const { data, error } = await _supabase.storage.from('user_files').createSignedUrl(filePath, 60); // URL is valid for 60 seconds

    if (error) {
      alert('Error getting download link: ' + error.message);
    } else {
      // Create a temporary link to trigger the download
      const link = document.createElement('a');
      link.href = data.signedUrl;
      link.download = filePath.split('/').pop(); // Get the original filename
      link.target = '_blank'; // Open in new tab (good for images/PDFs or just downloading)
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }
});
