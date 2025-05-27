#!/usr/bin/env node
const inquirer = require('inquirer').default;
const axios = require('axios');
const bitcoin = require('bitcoinjs-lib');
const bip39 = require('bip39');
const bip32 = require('bip32');

// Gunakan Bitcoin mainnet
const network = bitcoin.networks.bitcoin;

async function generateWallet() {
  const mnemonic = bip39.generateMnemonic();
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const root = bip32.fromSeed(seed, network);
  const account = root.derivePath("m/44'/0'/0'/0/0");
  const address = bitcoin.payments.p2pkh({ pubkey: account.publicKey, network }).address;
  const privateKey = account.toWIF();

  console.log('\n🔐 Wallet berhasil dibuat:');
  console.log('Mnemonic   :', mnemonic);
  console.log('Address    :', address);
  console.log('Private Key:', privateKey);
}

async function checkBalance() {
  const { address } = await inquirer.prompt({
    type: 'input',
    name: 'address',
    message: 'Masukkan Bitcoin address:'
  });

  try {
    const url = `https://blockstream.info/api/address/${address}`;
    const res = await axios.get(url);
    const balance = res.data.chain_stats.funded_txo_sum - res.data.chain_stats.spent_txo_sum;
    console.log(`\n💰 Saldo: ${balance/100000000} bitcoin`);
  } catch (err) {
    console.error('\n❌ Gagal mengambil saldo. Pastikan address valid dan koneksi internet aktif.');
  }
}

async function sendBitcoin() {
  const { privKey, toAddress, amount, fee } = await inquirer.prompt([
    { name: 'privKey', message: 'Masukkan private key (WIF):' },
    { name: 'toAddress', message: 'Masukkan alamat tujuan:' },
    { name: 'amount', message: 'Jumlah (satoshi):', validate: val => !isNaN(val) },
    { name: 'fee', message: 'Fee (satoshi):', default: 1000, validate: val => !isNaN(val) }
  ]);

  try {
    const keyPair = bitcoin.ECPair.fromWIF(privKey, network);
    const fromAddress = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network }).address;

    const utxos = (await axios.get(`https://blockstream.info/api/address/${fromAddress}/utxo`)).data;

    const psbt = new bitcoin.Psbt({ network });
    let totalInput = 0;

    for (const utxo of utxos) {
      if (totalInput >= +amount + +fee) break;

      const txHex = (await axios.get(`https://blockstream.info/api/tx/${utxo.txid}/hex`)).data;

      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        nonWitnessUtxo: Buffer.from(txHex, 'hex'),
      });

      totalInput += utxo.value;
    }

    if (totalInput < +amount + +fee) {
      console.error('\n❌ Saldo tidak mencukupi.');
      return;
    }

    psbt.addOutput({ address: toAddress, value: +amount });

    const change = totalInput - (+amount + +fee);
    if (change > 0) {
      psbt.addOutput({ address: fromAddress, value: change });
    }

    for (let i = 0; i < psbt.inputCount; i++) {
      psbt.signInput(i, keyPair);
    }

    psbt.validateSignaturesOfAllInputs();
    psbt.finalizeAllInputs();

    const txHex = psbt.extractTransaction().toHex();
    const txid = (await axios.post('https://blockstream.info/api/tx', txHex)).data;

    console.log(`\n🚀 Transaksi dikirim! TXID: ${txid}`);
  } catch (err) {
    console.error('\n❌ Gagal mengirim transaksi:', err.message || err);
  }
}

async function main() {
  while (true) {
    const { menu } = await inquirer.prompt({
      type: 'list',
      name: 'menu',
      message: 'Pilih menu:',
      choices: [
        { name: '1. Generate Bitcoin Wallet', value: 'generate' },
        { name: '2. Cek Saldo Wallet', value: 'balance' },
        { name: '3. Kirim Bitcoin', value: 'send' },
        { name: '4. Keluar', value: 'exit' },
      ],
    });

    if (menu === 'generate') await generateWallet();
    else if (menu === 'balance') await checkBalance();
    else if (menu === 'send') await sendBitcoin();
    else break;

    console.log('\n-----------------------------\n');
  }
}

main();
