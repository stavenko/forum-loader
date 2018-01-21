Скачиваем форум.

Как этим пользоваться:
0. Установить програмное обеспечение:
  $ brew install nvm
  $ brew install git
  $ nvm install 9.1
1. Скачать репозиторий с помощью git
    $ git clone https://github.com/stavenko/forum-loader;
2. зайти в папку и настроить пакет
    $ cd ./forum-loader
    $ npm i
3. зупастить скачивалку:
    node ./index.js --output <папку куда надо все скачать>

Фильтрация сообщений, и их модификация происходит в файле euristics.js.
