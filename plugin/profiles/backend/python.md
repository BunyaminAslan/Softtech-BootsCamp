# Profil: backend / python

> Kullanım: `AdditionalAgentInformation/team.json` → `"backend": { "profile": "python" }`.
> Bu profil `senior-backend-developer.md`'deki generic kuralları Python'a uyarlar; onları gevşetmez.

## Yığın (yeni projede varsayılan öneri)

| Katman | Varsayılan | Not |
|---|---|---|
| Runtime | Python (güncel kararlı, ör. 3.12+) | `requires-python` sabitlenir |
| Paket/ortam yönetimi | **uv** + `pyproject.toml` + `uv.lock` | Mevcut projede Poetry/pip-tools varsa ona uyulur |
| Framework | **FastAPI** (alternatif: Django + DRF yönetim paneli/ORM ağırlıklı projede) | Seçim ADR ile |
| Doğrulama / şema | **Pydantic v2** | OpenAPI FastAPI'den üretilir, sözleşmeyle karşılaştırılır |
| Veri erişimi | **SQLAlchemy 2.0** (async) + **Alembic** + PostgreSQL | Migration'lar kodla versiyonlanır |
| Hata modeli | RFC 9457 ProblemDetails | Merkezi exception handler |
| Loglama | structlog (JSON) + request id | PII loglanmaz |
| Kimlik | OAuth2/JWT (PyJWT) veya projede kararlaştırılan IdP | |
| Arka plan işleri | Celery veya arq (Redis) | Gereksinime göre ADR |
| Gözlemlenebilirlik | Health endpoint'leri, OpenTelemetry | `/health/live`, `/health/ready` |
| Test | **pytest** + pytest-asyncio + httpx `AsyncClient`, Testcontainers | |
| Kalite | **ruff** (lint + format), **mypy --strict** (veya pyright) | |

## Konvansiyonlar
- Katmanlar: `api/` (router) → `services/` (use case) → `repositories/` (veri) → `models/`. Router'da iş kuralı yok.
- Tip ipuçları zorunlu; public fonksiyonlarda dönüş tipi yazılır. `Any` gerekçesiz kullanılmaz.
- Async uçta bloklayan çağrı yok (senkron DB sürücüsü, `requests`, `time.sleep`); gerekiyorsa `run_in_threadpool`.
- Bağımlılıklar FastAPI `Depends` ile; global mutable state yok. DB oturumu istek başına.
- Konfigürasyon: `pydantic-settings`; açılışta doğrulanır. `.env` git'e girmez, `.env.example` güncel.
- İsimlendirme PEP 8; modül ve paketlerde döngüsel import yok.
- Tarih: timezone-aware `datetime` (UTC); para: `Decimal`.
- Ham SQL yalnızca parametreli (`text()` + bind parametreleri).

## Komutlar (project.md > Komutlar'a örnek)
Geliştirme sunucusu (reload modunda) kanıt değildir (K2/K5).

| Amaç | Komut |
|---|---|
| Kurulum | `uv sync --frozen -q` |
| Lint | `uv run ruff check .` |
| Format kontrolü | `uv run ruff format --check .` |
| Tip kontrolü | `uv run mypy .` |
| Test | `uv run pytest -q` |
| Kapsam | `uv run pytest --cov` |
| Güvenlik açığı taraması | `uvx pip-audit` |
| Migration | `uv run alembic revision --autogenerate -m "<ad>"` · `uv run alembic upgrade head` (yalnızca local DB) · `uv run alembic upgrade head --sql` (inceleme) |

## Test
| Tür | Araç |
|---|---|
| Unit | pytest |
| Integration | httpx `AsyncClient` + Testcontainers (gerçek DB) |
| Contract | Üretilen OpenAPI'nin sözleşme dosyasıyla karşılaştırılması |
Test isimleri `test_<davranış>_<koşul>`; fixture'lar `conftest.py`'de.

## Ağ izinleri (sandbox)
`setup-project` bu listeyi projenin `.claude/settings.json > sandbox.network.allowedDomains` alanına ekler (PLUGIN.md > 1.1).
- `pypi.org`: paket indeksi (`uv sync`, `pip install`)
- `files.pythonhosted.org`: paket indirmeleri

uv'nin Python sürümü indirmesi GitHub üzerindendir (ortak izinlerde var). Özel indeks (Artifactory, devpi) `team.json > sandbox.allowedDomains` ile eklenir. Testcontainers Docker soketi ister; karar kullanıcınındır.

## DoD ek maddeleri
- [ ] `uv run ruff check .`, `uv run ruff format --check .` ve `uv run mypy .` temiz
- [ ] `uv run pytest -q` geçiyor (K1 kanıtıyla)
- [ ] `uvx pip-audit` yeni yüksek/kritik açık göstermiyor
- [ ] Yeni migration'ın SQL'i (`alembic upgrade head --sql`) incelendi

## Yetkinlik vurguları
asyncio ve event loop, Pydantic v2 doğrulama/serileştirme, SQLAlchemy 2.0 (unit of work, eager loading), FastAPI dependency injection, py-spy / cProfile ile profil çıkarma.
