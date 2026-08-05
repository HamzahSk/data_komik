import fs from 'fs/promises';
import path from 'path';

// Variable Caching di memori Vercel (RAM)
let cachedGenreMap = null;

async function getAllGenreData() {
    // Jika data sudah pernah dibaca sebelumnya di instance yang sama, pakai dari RAM
    if (cachedGenreMap) return cachedGenreMap;

    const genreDir = path.join(process.cwd(), 'genre');
    const genreMap = new Map();

    try {
        const files = await fs.readdir(genreDir);

        for (const file of files) {
            if (file.endsWith('.json')) {
                // Ekstrak nama genre, misal: genre_martial_art.json -> martial_art atau martial art
                const genreKey = file
                    .replace(/^genre_/, '')
                    .replace(/\.json$/, '')
                    .replace(/_/g, ' ')
                    .toLowerCase();

                const filePath = path.join(genreDir, file);
                const content = await fs.readFile(filePath, 'utf-8');
                const data = JSON.parse(content);

                genreMap.set(genreKey, data);
            }
        }

        cachedGenreMap = genreMap;
        return cachedGenreMap;
    } catch (error) {
        console.error('❌ Gagal membaca folder genre:', error.message);
        return new Map();
    }
}

export default async function handler(req, res) {
    // 1. Set Header CORS agar aman dipanggil dari domain mana saja
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { q = '', filter = '' } = req.query;
        const genreMap = await getAllGenreData();

        // Parse filter (contoh input: "Action, Romance" -> ["action", "romance"])
        const selectedGenres = filter
            .split(',')
            .map((g) => g.trim().toLowerCase())
            .filter((g) => g.length > 0);

        let candidateComics = [];

        // 2. LOGIKA FILTER GENRE (LOGIKA 'DAN' / AND)
        if (selectedGenres.length > 0) {
            const genreDatasets = [];

            for (const genre of selectedGenres) {
                if (genreMap.has(genre)) {
                    genreDatasets.push(genreMap.get(genre));
                } else {
                    // Jika ada 1 genre yang tidak ditemukan di database,
                    // maka komik yang memenuhi SEMUA filter pasti tidak ada.
                    genreDatasets.push([]);
                }
            }

            // Ambil dataset genre pertama sebagai acuan
            const firstDataset = genreDatasets[0] || [];

            // Irisan (Intersection): Komik harus ada di SELURUH dataset genre yang dipilih
            candidateComics = firstDataset.filter((komik) => {
                return genreDatasets.every((dataset) =>
                    dataset.some((item) => item.url === komik.url)
                );
            });
        } else {
            // Jika TANPA FILTER GENRE, gabungkan semua komik dari seluruh file genre
            const allComics = [];
            for (const dataset of genreMap.values()) {
                allComics.push(...dataset);
            }

            // Hapus duplikat berdasarkan URL
            const seenUrls = new Set();
            candidateComics = allComics.filter((komik) => {
                if (seenUrls.has(komik.url)) return false;
                seenUrls.add(komik.url);
                return true;
            });
        }

        // 3. LOGIKA SEARCH QUERY 'q'
        const searchQuery = q.trim().toLowerCase();
        let finalResults = candidateComics;

        if (searchQuery) {
            finalResults = candidateComics.filter((komik) =>
                komik.title.toLowerCase().includes(searchQuery)
            );
        }

        // 4. RESPONSE HASIL
        return res.status(200).json({
            status: 'success',
            total: finalResults.length,
            query: searchQuery,
            filters: selectedGenres,
            data: finalResults
        });

    } catch (error) {
        return res.status(500).json({
            status: 'error',
            message: 'Terjadi kesalahan pada server',
            error: error.message
        });
    }
}
