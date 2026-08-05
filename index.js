import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';

const BASE_URL = 'https://mirrorinkomik.my.id';

// Membaca genre yang dikirim dari GitHub Actions
const targetGenre = process.env.TARGET_GENRE;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function scrapeGenre(genre) {
    let page = 1;
    let lastId = null;
    let hasNextPage = true;
    const results = [];

    console.log(`\n🚀 Memulai PULL LENGKAP untuk genre: ${genre}...`);

    while (hasNextPage) {
        try {
            let htmlToParse = '';

            if (page === 1) {
                const response = await axios.get(`${BASE_URL}/Genre/${genre}`);
                htmlToParse = response.data;
                const $ = cheerio.load(htmlToParse);
                lastId = $('#load-more').attr('data-last-id');
            } else {
                const response = await axios.get(`${BASE_URL}/loadmore-type`, {
                    params: { type: genre, last_id: lastId },
                    headers: { 'X-Requested-With': 'XMLHttpRequest' }
                });
                
                const data = response.data;
                htmlToParse = data.html || '';
                lastId = data.lastId;
            }

            if (lastId === '0' || !lastId) {
                lastId = null;
                hasNextPage = false;
            } else {
                page++;
            }

            const $ = cheerio.load(htmlToParse);
            const cards = $('a.komik-card, #genre-list .bsx a[title]');
            
            // Catat jumlah sebelum di push untuk ngecek halaman kosong/diblokir
            let jumlahSebelumnya = results.length;

            cards.each((i, el) => {
                let url = $(el).attr('href');
                if (url && !url.startsWith('http')) url = `${BASE_URL}${url}`;

                let title = $(el).find('.komik-info h3').text().trim() || $(el).attr('title')?.trim();
                let thumb = $(el).find('.komik-cover img').attr('src') || $(el).find('img').attr('src');

                if (title && url) {
                    results.push({ title, url, thumbnail_url: thumb || null });
                }
            });

            // Deteksi jika server mulai ngaco/kosong
            if (results.length === jumlahSebelumnya && htmlToParse.trim() !== '') {
                console.log(`⚠️ Halaman terdeteksi tidak menghasilkan komik baru. Kemungkinan limit server. Menghentikan scrape.`);
                hasNextPage = false;
            } else {
                console.log(`   [${genre}] Berhasil memproses ${results.length} judul (Last ID: ${lastId || 'TAMAT'})`);
            }

            // Jeda dinaikkan jadi 3 detik biar lebih aman dari blokir
            if (hasNextPage) await delay(3000); 

        } catch (error) {
            console.error(`❌ Error pada genre ${genre} (Halaman ${page}):`, error.message);
            hasNextPage = false; 
        }
    }

    // Buat folder 'genre' jika belum ada, lalu simpan file di dalamnya
    await fs.mkdir('genre', { recursive: true });
    
    const fileName = `genre_${genre.toLowerCase().replace(/\s/g, '_')}.json`;
    await fs.writeFile(`genre/${fileName}`, JSON.stringify(results, null, 2));
    console.log(`✅ Selesai! Data genre ${genre} tersimpan di genre/${fileName} (Total: ${results.length} judul)`);
}

// Eksekusi utama
if (!targetGenre) {
    console.error("❌ Target genre tidak ditemukan! Pastikan dijalankan via GitHub Actions dengan parameter genre.");
    process.exit(1);
} else {
    scrapeGenre(targetGenre);
}
