# Changelog

## v1.0.1

**Perbaikan pertama: memindahkan item di bilah samping, nama tab, dan laporan kerusakan.**

- **Memindahkan item di bilah samping tidak lagi merusak aplikasi.** Dengan mini browser, Pengaturan, atau log MCP terbuka, menyeret baris mana pun di bilah samping merobohkan antarmuka, dan hanya memulai ulang yang memulihkannya.
- **Mengganti nama item kini memperbarui setiap tab yang terbuka** — termasuk tab di panel terbagi dan tab semua jenis permintaan (gRPC, GraphQL, Redis…), yang sebelumnya menyimpan nama lamanya sampai dibuka kembali.
- **Laporan kerusakan kembali sampai ke kami.** Dengan pelaporan aktif, 1.0.0 diam-diam tidak mengirim apa pun: kerusakan yang Anda alami tidak memberi tahu kami apa-apa.
- **Ilustrasi “bahasa pemrograman” menampilkan logonya lagi.**

## v1.0.0

**Restorm 1.0 — klien API local-first, resmi dirilis.**

Restorm adalah klien desktop yang cepat dan mengutamakan mode offline untuk menguji dan menjalankan API di semua protokol utama.

- **Protokol**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Skenario**: rangkai permintaan secara visual, percabangan/perulangan, ekstrak dan gunakan ulang nilai, jalankan tanpa antarmuka di CI.
- **Lingkungan & variabel**: `{{handlebars}}` di mana saja, secret bertipe, lingkungan per folder.
- **Impor/Ekspor**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, ekspor kode.
- **Proyek native Git**: proyek `.restorm` Anda adalah berkas biasa — kelola versi, bandingkan, dan selesaikan konflik di dalam aplikasi.
- **Local-first & privat**: semuanya berjalan di komputer Anda; firewall keluar mengawasi setiap panggilan eksternal.
- **Lintas platform**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Edisi Community gratis, dengan Pro & Enterprise untuk tim.
