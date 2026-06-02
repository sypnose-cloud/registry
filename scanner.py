#!/usr/bin/env python3
"""
Registry Universal — ESCANER DE SERVIDOR (L1)
=============================================

Enumera DINAMICAMENTE todo lo que corre en un servidor Linux usando comandos
nativos (no listas hardcodeadas). Capa L1 (runtime) del Registry: complementa
la capa de codigo (codegraph/backstage) describiendo lo que esta VIVO ahora:

  - servicios systemd (sistema + usuario)
  - contenedores docker
  - puertos en escucha (ss, fallback netstat)
  - repositorios git bajo unas raices
  - procesos clave en los puertos detectados

Sin dependencias externas: solo stdlib + subprocess.
Escritura atomica (tmp + os.replace). Tolerante a fallos por comando: si
docker/ss no existe, esa seccion queda vacia y el resto del escaneo continua.

Uso:
    python3 scanner.py
    python3 scanner.py --roots "/home,/opt" --out ~/.registry-data/server-scan.json
    python3 scanner.py --max-depth 3
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

DEFAULT_ROOTS = ["/home", "/opt"]
DEFAULT_OUT = os.path.join(os.path.expanduser("~"), ".registry-data", "server-scan.json")
DEFAULT_MAX_DEPTH = 3
CMD_TIMEOUT = 20  # segundos por comando — un comando colgado no bloquea el escaneo

# Directorios que nunca contienen repos "propios" relevantes y que ademas
# esconden cientos de .git internos (dependencias). Se podan al caminar.
PRUNE_DIRS = {
    "node_modules", "vendor", ".cache", ".npm", ".cargo", ".rustup",
    "site-packages", "dist-packages", "__pycache__", ".venv", "venv",
    ".terraform", "bower_components", ".pnpm-store",
}


# ---------------------------------------------------------------------------
# Helper de ejecucion: aisla CADA comando. Nunca propaga excepcion.
# ---------------------------------------------------------------------------
def run_cmd(args):
    """Ejecuta un comando y devuelve (ok, stdout, err_str).

    ok=False si el binario no existe, da timeout, o sale con codigo != 0.
    NUNCA lanza excepcion: el escaneo de otras secciones debe continuar.
    """
    binary = args[0]
    if shutil.which(binary) is None:
        return False, "", f"{binary}: not found in PATH"
    try:
        proc = subprocess.run(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=CMD_TIMEOUT,
            text=True,
        )
    except subprocess.TimeoutExpired:
        return False, "", f"{binary}: timeout after {CMD_TIMEOUT}s"
    except Exception as exc:  # noqa: BLE001 — defensivo: cualquier OSError, etc.
        return False, "", f"{binary}: {exc}"

    if proc.returncode != 0:
        # Algunos comandos (ss sin permiso para -p) devuelven datos utiles
        # igualmente; conservamos stdout si lo hay.
        err = (proc.stderr or "").strip() or f"exit code {proc.returncode}"
        return bool(proc.stdout), proc.stdout or "", err
    return True, proc.stdout or "", ""


# ---------------------------------------------------------------------------
# 1. SERVICIOS systemd (sistema + usuario)
# ---------------------------------------------------------------------------
def scan_services():
    """Lista servicios systemd en estado 'running' (scope system + user)."""
    services = []

    def collect(scope, extra_args):
        base = ["systemctl"] + extra_args + [
            "list-units", "--type=service", "--state=running",
            "--no-legend", "--plain", "--no-pager",
        ]
        ok, out, _err = run_cmd(base)
        if not ok:
            return
        for line in out.splitlines():
            line = line.strip()
            if not line:
                continue
            # Formato --plain --no-legend: UNIT LOAD ACTIVE SUB DESCRIPTION...
            parts = line.split(None, 4)
            if not parts:
                continue
            unit = parts[0]
            if not unit.endswith(".service"):
                continue
            sub_state = parts[3] if len(parts) >= 4 else "running"
            services.append({
                "name": unit,
                "state": sub_state,   # p.ej. 'running'
                "scope": scope,       # 'system' | 'user'
            })

    collect("system", [])
    collect("user", ["--user"])  # si no hay bus de usuario, run_cmd ya lo absorbe

    # Dedup por (name, scope) preservando orden.
    seen = set()
    deduped = []
    for svc in services:
        key = (svc["name"], svc["scope"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(svc)
    return deduped


# ---------------------------------------------------------------------------
# 2. CONTENEDORES docker
# ---------------------------------------------------------------------------
def scan_containers():
    """Lista contenedores docker en ejecucion. Vacio si docker no existe."""
    containers = []
    ok, out, _err = run_cmd(["docker", "ps", "--format", "{{json .}}"])
    if not ok:
        return containers
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        containers.append({
            "name": obj.get("Names", ""),
            "image": obj.get("Image", ""),
            "status": obj.get("Status", ""),
            "ports": obj.get("Ports", ""),
        })
    return containers


# ---------------------------------------------------------------------------
# 3. PUERTOS en escucha (ss preferido, netstat fallback)
# ---------------------------------------------------------------------------
# users:(("nginx",pid=1234,fd=6),("nginx",pid=1235,fd=6))
_SS_PROC_RE = re.compile(r'\("([^"]+)",pid=(\d+)')
# direccion local: 0.0.0.0:80 / [::]:443 / 127.0.0.1:5432 / *:22
_ADDR_PORT_RE = re.compile(r":(\d+)$")


def _port_from_local_addr(addr):
    m = _ADDR_PORT_RE.search(addr)
    if not m:
        return None
    try:
        return int(m.group(1))
    except ValueError:
        return None


def _parse_ss(out):
    rows = []
    for line in out.splitlines():
        line = line.rstrip()
        if not line:
            continue
        low = line.lstrip()
        # Saltar cabecera de ss (-tlnp imprime 'State Recv-Q ... Process')
        if low.startswith("State") or low.startswith("Netid"):
            continue
        cols = line.split()
        if len(cols) < 5:
            continue
        # ss -tlnp columnas: State Recv-Q Send-Q Local:Port Peer:Port [Process]
        local_addr = cols[3]
        port = _port_from_local_addr(local_addr)
        if port is None:
            continue
        proc_field = " ".join(cols[5:]) if len(cols) > 5 else ""
        m = _SS_PROC_RE.search(proc_field)
        process = m.group(1) if m else ""
        pid = int(m.group(2)) if m else None
        rows.append({"port": port, "proto": "tcp", "process": process, "pid": pid})
    return rows


def _parse_netstat(out):
    rows = []
    for line in out.splitlines():
        cols = line.split()
        # netstat -tlnp: Proto Recv-Q Send-Q Local Foreign State PID/Program
        if len(cols) < 4 or not cols[0].startswith("tcp"):
            continue
        port = _port_from_local_addr(cols[3])
        if port is None:
            continue
        process = ""
        pid = None
        if len(cols) >= 7 and "/" in cols[6]:
            pid_str, _, name = cols[6].partition("/")
            process = name
            try:
                pid = int(pid_str)
            except ValueError:
                pid = None
        rows.append({"port": port, "proto": "tcp", "process": process, "pid": pid})
    return rows


def scan_ports():
    """Puertos TCP en escucha. ss primero; si falla, netstat."""
    rows = []
    ok, out, _err = run_cmd(["ss", "-tlnp"])
    if ok and out.strip():
        rows = _parse_ss(out)
    else:
        ok2, out2, _err2 = run_cmd(["netstat", "-tlnp"])
        if ok2 and out2.strip():
            rows = _parse_netstat(out2)

    # Dedup por (port, proto), conservando el primer registro con proceso conocido.
    by_key = {}
    for r in rows:
        key = (r["port"], r["proto"])
        prev = by_key.get(key)
        if prev is None or (not prev["process"] and r["process"]):
            by_key[key] = r
    return sorted(by_key.values(), key=lambda r: r["port"])


# ---------------------------------------------------------------------------
# 4. REPOS git (walk acotado, sin 'find', podando deps)
# ---------------------------------------------------------------------------
def scan_repos(roots, max_depth):
    """Busca carpetas con .git bajo cada raiz, hasta max_depth de profundidad.

    Una vez encontrado un repo, NO se desciende dentro (los .git de submodulos
    o de node_modules internos no se reportan como repos independientes).
    """
    repos = []
    seen_paths = set()

    for root in roots:
        root = os.path.abspath(os.path.expanduser(root.strip()))
        if not root or not os.path.isdir(root):
            continue

        root_depth = root.rstrip(os.sep).count(os.sep)

        for dirpath, dirnames, _filenames in os.walk(root, topdown=True):
            depth = dirpath.rstrip(os.sep).count(os.sep) - root_depth

            # Podar directorios de dependencias y ocultos irrelevantes.
            dirnames[:] = [
                d for d in dirnames
                if d not in PRUNE_DIRS and not d.startswith(".git")
            ]

            # Limite de profundidad: no descender mas alla de max_depth.
            if depth >= max_depth:
                dirnames[:] = []

            git_path = os.path.join(dirpath, ".git")
            is_repo = os.path.isdir(git_path) or os.path.isfile(git_path)
            if is_repo:
                # ¿Este dir contiene sub-repos (carpetas hijas con .git)? Caso
                # monorepo / carpeta-contenedor de repos (p.ej. /home/user que es repo
                # git de dotfiles y aloja 15 proyectos).
                has_subrepos = False
                for d in dirnames:
                    sub = os.path.join(dirpath, d)
                    if os.path.isdir(os.path.join(sub, ".git")) or os.path.isfile(os.path.join(sub, ".git")):
                        has_subrepos = True
                        break
                # Un home de usuario (/home/X) o root (/root) que SOLO es repo por
                # tener dotfiles versionados NO es un proyecto: indexarlo entero
                # (cientos de miles de ficheros) revienta trace-mcp/graphify. Si es un
                # home Y contiene sub-repos, lo tratamos como contenedor: NO se agrega,
                # solo se desciende a sus hijos.
                parent = os.path.dirname(dirpath.rstrip(os.sep))
                is_home_like = parent in ("/home", "/Users") or dirpath.rstrip(os.sep) == "/root"
                skip_self = is_home_like and has_subrepos
                if not skip_self:
                    real = os.path.realpath(dirpath)
                    if real not in seen_paths:
                        seen_paths.add(real)
                        repos.append({
                            "path": dirpath,
                            "name": os.path.basename(dirpath.rstrip(os.sep)) or dirpath,
                            "has_git": True,
                        })
                # Si contiene sub-repos, seguimos descendiendo para capturarlos.
                # Si NO, dejamos de descender (no entrar en src/, lib/, etc.).
                if not has_subrepos:
                    dirnames[:] = []

    repos.sort(key=lambda r: r["path"])
    return repos


# ---------------------------------------------------------------------------
# 5. PROCESOS clave: los que sostienen los puertos detectados
# ---------------------------------------------------------------------------
INTERESTING_PROCS = (
    "node", "python", "python3", "gunicorn", "uvicorn", "deno", "bun",
    "java", "ruby", "puma", "php", "php-fpm", "go", "rust", "nginx",
    "caddy", "apache2", "httpd", "postgres", "mysqld", "mariadbd",
    "redis-server", "mongod", "dockerd", "containerd",
)


def _proc_command(pid):
    """Comando completo de un pid via /proc/<pid>/cmdline. '' si no accesible."""
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as fh:
            raw = fh.read()
    except (OSError, IOError):
        return ""
    if not raw:
        return ""
    return raw.replace(b"\x00", b" ").decode("utf-8", "replace").strip()


def scan_key_processes(ports):
    """Procesos clave deducidos de los puertos en escucha.

    No vuelve a escanear todo `ps`: usa los pid/proceso que ya descubrimos en
    los puertos, enriquecidos con el cmdline de /proc cuando esta disponible.
    """
    procs = []
    seen_pids = set()
    for p in ports:
        pid = p.get("pid")
        name = p.get("process") or ""
        if pid is None and not name:
            continue
        if pid is not None and pid in seen_pids:
            continue
        # Filtrar a procesos "clave" si conocemos el nombre; si no, incluir igual
        # (un puerto con proceso desconocido tambien es informacion util).
        base_name = name.split()[0] if name else ""
        if base_name and base_name not in INTERESTING_PROCS:
            # Aun asi lo incluimos: el objetivo es mapear quien sirve cada puerto.
            pass
        if pid is not None:
            seen_pids.add(pid)
        procs.append({
            "pid": pid,
            "name": name,
            "port": p.get("port"),
            "command": _proc_command(pid) if pid is not None else "",
        })
    return procs


# ---------------------------------------------------------------------------
# Escritura atomica
# ---------------------------------------------------------------------------
def write_atomic(path, data):
    """Escribe JSON de forma atomica: tmp en el mismo dir + os.replace."""
    path = os.path.abspath(os.path.expanduser(path))
    out_dir = os.path.dirname(path) or "."
    os.makedirs(out_dir, exist_ok=True)

    fd, tmp_path = tempfile.mkstemp(prefix=".server-scan-", suffix=".tmp", dir=out_dir)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_path, path)  # atomico en el mismo filesystem
    except Exception:
        # Limpieza del tmp si algo falla antes del replace.
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------------------
# Orquestacion
# ---------------------------------------------------------------------------
def build_scan(roots, max_depth):
    services = scan_services()
    containers = scan_containers()
    ports = scan_ports()
    repos = scan_repos(roots, max_depth)
    key_procs = scan_key_processes(ports)

    return {
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "hostname": socket.gethostname(),
        "services": services,
        "containers": containers,
        "ports": ports,
        "repos": repos,
        "key_processes": key_procs,
        "summary": {
            "n_services": len(services),
            "n_containers": len(containers),
            "n_ports": len(ports),
            "n_repos": len(repos),
        },
    }


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description="Registry L1 — escaner dinamico de servidor Linux (stdlib only).",
    )
    parser.add_argument(
        "--roots",
        default=",".join(DEFAULT_ROOTS),
        help='Raices para buscar repos git, separadas por coma. Default "/home,/opt".',
    )
    parser.add_argument(
        "--out",
        default=DEFAULT_OUT,
        help="Ruta del JSON de salida. Default ~/.registry-data/server-scan.json",
    )
    parser.add_argument(
        "--max-depth",
        type=int,
        default=DEFAULT_MAX_DEPTH,
        help="Profundidad maxima de busqueda de repos. Default 3.",
    )
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv if argv is not None else sys.argv[1:])
    roots = [r for r in args.roots.split(",") if r.strip()]

    scan = build_scan(roots, args.max_depth)

    try:
        write_atomic(args.out, scan)
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR escribiendo {args.out}: {exc}", file=sys.stderr)
        return 1

    s = scan["summary"]
    print(
        f"[registry-L1] {scan['hostname']} @ {scan['scanned_at']} -> "
        f"{os.path.abspath(os.path.expanduser(args.out))}"
    )
    print(
        f"  services={s['n_services']} containers={s['n_containers']} "
        f"ports={s['n_ports']} repos={s['n_repos']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
