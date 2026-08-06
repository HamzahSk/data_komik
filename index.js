import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';

const BASE_URL = 'https://mirrorinkomik.my.id';
const targetGenre = process.env.TARGET_GENRE;

const USERNAME = "rocckyroo";
const PASSWORD = "lgDsFOZtGcDf11Ol";

// ==========================================
// SISTEM COOKIE JAR MINI (Meniru Kotlin OkHttp)
// ==========================================
// Objek untuk menampung semua cookie (key: value)
const cookieJar = {};

// Fungsi untuk mengekstrak dan menyimpan/memperbarui cookie dari header 'set-cookie'
function updateCookies(setCookieArray) {
    if (!setCookieArray || !Array.isArray(setCookieArray)) return;
    
    setCookieArray.forEach(cookieStr => {
        // Ambil bagian utama sebelum tanda ';' (misal: "ci_session=abcd123")
        const mainPart = cookieStr.split(';')[0];
        const delimiterIndex = mainPart.indexOf('=');
        if (delimiterIndex !== -1) {
            const key = mainPart.substring(0, delimiterIndex).trim();
            const value = mainPart.substring(delimiterIndex + 1).trim();
            cookieJar[key] = value;
        }
    });
}

// Fungsi untuk merakit kembali semua cookie menjadi string untuk header HTTP
function getCookieString() {
    return Object.entries(cookieJar)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
}

// ==========================================
// HEADERS
// ==========================================
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Referer': `${BASE_URL}/`,
    'Accept-Language': 'en-US,en;q=0.9,id;q=0.8'
};

const XHR_HEADERS = {
    ...DEFAULT_HEADERS,
    'X-Requested-With': 'XMLHttpRequest'
};

// ==========================================
// FUNGSI LOGIN
// ==========================================
async function loginSite() {
    if (!USERNAME || !PASSWORD) {
        console.warn("⚠️ Username atau Password tidak diatur. Melanjutkan tanpa login...");
        return;
    }

    console.log("🔐 Memulai proses login untuk mengambil cookie...");
    try {
        // Langkah 1: Kunjungi halaman login (GET)
        const getResponse = await axios.get(`${BASE_URL}/login`, { 
            headers: DEFAULT_HEADERS 
        });
        
        // Simpan semua cookie awal yang diberikan server
        updateCookies(getResponse.headers['set-cookie']);

        const $ = cheerio.load(getResponse.data);
        const csrfToken = $('input[name="csrf_test_name"]').val();

        if (!csrfToken) {
            throw new Error("CSRF token tidak ditemukan di halaman login.");
        }

        // Langkah 2: Kirim form login (POST)
        const formData = new URLSearchParams();
        formData.append('csrf_test_name', csrfToken);
        formData.append('login', USERNAME);
        formData.append('password', PASSWORD);

        const postResponse = await axios.post(`${BASE_URL}/login`, formData.toString(), {
            headers: {
                ...DEFAULT_HEADERS,
                'Content-Type': 'application/x-www-form-urlencoded',
                // Masukkan cookie dari GET request sebelumnya
                'Cookie': getCookieString(), 
                // Tambahkan Origin dan pastikan Referer mengarah ke halaman login
                'Origin': BASE_URL,
                'Referer': `${BASE_URL}/login`
            },
            // PENTING: Jangan ikuti redirect otomatis secara penuh dulu, 
            // kita harus tangkap cookie saat status 302 (Redirect Sukses Login)
            maxRedirects: 0, 
            validateStatus: function (status) {
                // Anggap status 302 (Redirect) sebagai sukses karena itu tanda login berhasil
                return status >= 200 && status < 400; 
            }
        });

        // Simpan cookie terbaru (biasanya ci_session yang sudah terautentikasi ada di sini)
        updateCookies(postResponse.headers['set-cookie']);

        console.log("✅ Login berhasil! Cookie lengkap sudah tersimpan.");
        // console.log("🍪 Current Cookies:", getCookieString()); // Buka ini kalau mau ngecek isi cookienya

        await delay(2000); 
    } catch (error) {
        console.error("❌ Gagal login:", error.message);
        process.exit(1); 
    }
}

// ==========================================
// FUNGSI AUTO-RETRY
// ==========================================
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
    // Selalu sisipkan cookie terbaru ke setiap request
    const finalHeaders = { ...options.headers };
    const currentCookies = getCookieString();
    if (currentCookies) {
        finalHeaders['Cookie'] = currentCookies;
    }

    const finalOptions = { ...options, headers: finalHeaders, timeout: 15000 };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await axios.get(url, finalOptions);
        } catch (error) {
            console.log(`   ⏳ [Peringatan] Request gagal (${error.message}). Percobaan ${attempt}/${maxRetries}...`);
            if (attempt === maxRetries) throw error;
            await delay(3000);
        }
    }
}

// ==========================================
// FUNGSI SCRAPE GENRE
// ==========================================
async function scrapeGenre(genre) {
    let page = 1;
    let lastId = null;
    let hasNextPage = true;
    const results = [];
    const seenUrls = new Set();

    console.log(`\n🚀 Memulai PULL LENGKAP untuk genre: ${genre}...`);

    while (hasNextPage) {
        try {
            let htmlToParse = '';

            if (page === 1) {
                const safeGenre = genre.toLowerCase().replace(/\s/g, '%20');
                const response = await fetchWithRetry(`${BASE_URL}/genre/${safeGenre}`, {
                    headers: DEFAULT_HEADERS
                });
                // Update cookie lagi siapa tahu server me-refresh session
                updateCookies(response.headers['set-cookie']);
                
                htmlToParse = response.data;
                const $ = cheerio.load(htmlToParse);
                lastId = $('#load-more').attr('data-last-id');
            } else {
                const response = await fetchWithRetry(`${BASE_URL}/loadmore-type`, {
                    params: { type: genre, last_id: lastId },
                    headers: XHR_HEADERS
                });
                
                updateCookies(response.headers['set-cookie']);

                if (typeof response.data === 'object') {
                    htmlToParse = response.data.html || '';
                    lastId = response.data.lastId;
                } else {
                    htmlToParse = response.data || '';
                }
            }

            if (lastId === '0' || !lastId) {
                lastId = null;
                hasNextPage = false;
            } else {
                page++;
            }

            const $ = cheerio.load(htmlToParse);
            const cards = $('.bsx a[title], a.komik-card');
            let jumlahSebelumnya = results.length;

            cards.each((i, el) => {
                let url = $(el).attr('href');
                if (url && !url.startsWith('http')) url = `${BASE_URL}${url}`;

                let title = $(el).attr('title')?.trim() 
                         || $(el).find('.tt').text().trim() 
                         || $(el).find('.komik-info h3').text().trim();
                
                let thumb = $(el).find('img').attr('abs:src') 
                         || $(el).find('img').attr('src');

                if (title && url && !seenUrls.has(url)) {
                    seenUrls.add(url);
                    results.push({ title, url, thumbnail_url: thumb || null });
                }
            });

            if (results.length === jumlahSebelumnya && htmlToParse.trim() !== '') {
                console.log(`⚠️ Halaman terdeteksi tidak menghasilkan komik baru. Kemungkinan limit server. Menghentikan scrape.`);
                hasNextPage = false;
            } else {
                console.log(`   [${genre}] Berhasil memproses ${results.length} judul (Last ID: ${lastId || 'TAMAT'})`);
            }

            if (hasNextPage) await delay(3000); 

        } catch (error) {
            console.error(`❌ Error pada genre ${genre} (Halaman ${page}):`, error.message);
            hasNextPage = false; 
        }
    }

    await fs.mkdir('genre', { recursive: true });
    const fileName = `genre_${genre.toLowerCase().replace(/\s/g, '_')}.json`;
    await fs.writeFile(`genre/${fileName}`, JSON.stringify(results, null, 2));
    console.log(`✅ Selesai! Data genre ${genre} tersimpan di genre/${fileName} (Total: ${results.length} judul)`);
}

// ==========================================
// EKSEKUSI UTAMA
// ==========================================
async function main() {
    if (!targetGenre) {
        console.error("❌ Target genre tidak ditemukan! Pastikan dijalankan via GitHub Actions dengan parameter genre.");
        process.exit(1);
    }
    await loginSite();
    await scrapeGenre(targetGenre);
}

main();
