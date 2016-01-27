#!/bin/sh

# TODO clean first

echo "Downloading libp2p"
mkdir -p tests/utp
cd tests/utp

wget https://github.com/bittorrent/libutp/archive/master.zip 
unzip master.zip
cd libutp-master

echo "Compiling libp2p"
make

echo "Making ucat-static bin available"
cp ucat-static /usr/local/bin/ucat-static
