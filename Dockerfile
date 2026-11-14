FROM oven/bun:1

WORKDIR /app

# Aqui eu estou copiando os arquivos de manifesto (package.json e bun.lock) antes dos arquivos de código-fonte para que a camada de dependências seja armazenada em cache e só seja reconstruída quando o package.json ou o arquivo de bloqueio (lockfile) forem alterados. Isso ajuda a acelerar o processo de construção da imagem Docker, evitando reinstalar dependências desnecessariamente.

COPY package.json bun.lock* ./
RUN bun install

COPY . .
