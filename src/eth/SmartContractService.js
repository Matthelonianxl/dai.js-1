import PublicService from '../core/PublicService';
import Web3Service from './Web3Service';
import contracts from '../../contracts/contracts';
import tokens from '../../contracts/tokens';
import networks from '../../contracts/networks';
import ObjectWrapper from '../utils/ObjectWrapper';
import { Contract } from 'ethers';
import '../polyfills';

export default class SmartContractService extends PublicService {
  static buildTestService(web3 = null, suppressOutput = true) {
    const service = new SmartContractService();
    web3 = web3 || Web3Service.buildTestService(null, 5000, suppressOutput);

    service
      .manager()
      .inject('log', web3.get('log'))
      .inject('web3', web3);

    return service;
  }

  constructor(name = 'smartContract') {
    super(name, ['web3', 'log']);
  }

  getContractByAddressAndAbi(address, abi, name = null) {
    if (!address) {
      throw Error('Contract address is required');
    }

    if (!name) {
      name = this.lookupContractName(address);
    }

    const signer = this.get('web3').ethersSigner(),
      contract = new Contract(address, abi, signer);

    return ObjectWrapper.addWrapperInterface(
      { _original: contract }, contract, [], true, false, false,
      {
        afterGet: (k, v) => this.get('log').info('GET ' + name + '.' + k + ' >> \'' + v.toString() + '\''),
        onSet: (k, v) => this.get('log').info('SET ' + name + '.' + k + ' =\'' + v.toString() + '\''),
        onCall: (k, args) => {
          signer.getAddress().then(fromAddress => {
            this.get('log').info(
              `${fromAddress} >> ${name}.${k}(` +
              (args.length > 0 ? '\'' : '') +
              args.map(a => a.toString()).join('\', \'') +
              (args.length > 0 ? '\')' : ')')
            );
          });
        }
      });
  }

  getContractByName(name, version = null) {
    const info = this._getContractInfo(name, version);
    return this.getContractByAddressAndAbi(info.address, info.abi);
  }

  lookupContractName(address) {
    address = address.toUpperCase();

    const mapping = this._getCurrentNetworkMapping()[0].addresses,
      names = Object.keys(mapping);

    for (let i = 0; i < names.length; i++) {
      for (let j = 0; j < mapping[names[i]].length; j++) {
        if (mapping[names[i]][j].address.toUpperCase() === address) {
          return names[i];
        }
      }
    }

    return null;
  }

  getContractState(
    name,
    recursion = 0,
    beautify = true,
    exclude = ['tag', 'SAI_PEP.read'],
    visited = []
  ) {
    const info = this._getContractInfo(name),
      contract = this.getContractByAddressAndAbi(info.address, info.abi),
      inspectableMembers = info.abi
        .filter(m => m.constant && m.inputs.length < 1)
        .map(m => {
          const member = m.name;

          if (
            exclude.indexOf(member) > -1 ||
            exclude.indexOf(name + '.' + member) > -1
          ) {
            return {
              name: member,
              promise: Promise.resolve('[EXCLUDED]')
            };
          }

          return {
            name: member,
            promise: contract[m.name]().catch(
              reason => '[ERROR: ' + reason + ']'
            )
          };
        });

    visited = visited.concat([name]);

    return Promise.all(inspectableMembers.map(m => m.promise))
      .then(results => {
        const valuePromises = [];
        for (let i = 0; i < results.length; i++) {
          const key = inspectableMembers[i].name,
            value = results[i],
            contractName = this.lookupContractName(value.toString());

          if (
            contractName &&
            recursion > 0 &&
            visited.indexOf(contractName) < 0
          ) {
            valuePromises.push(
              this.getContractState(
                contractName,
                recursion - 1,
                beautify,
                exclude,
                visited
              ).then(childState => [key, childState])
            );
            visited = visited.concat([contractName]);
          } else if (contractName && visited.indexOf(contractName) > -1) {
            valuePromises.push([
              key,
              beautify ? value + '; ' + contractName + '; [VISITED]' : value
            ]);
          } else if (contractName) {
            valuePromises.push([
              key,
              beautify ? value + '; ' + contractName : value
            ]);
          } else {
            valuePromises.push([key, beautify ? value.toString() : value]);
          }
        }

        return Promise.all(valuePromises);
      })
      .then(values => {
        const result = { __self: contract.getAddress() + '; ' + name };
        values.forEach(v => (result[v[0]] = v.length > 2 ? v.slice(1) : v[1]));
        return result;
      });
  }

  stringToBytes32(text) {
    const ethersUtils = this.get('web3').ethersUtils();
    var data = ethersUtils.toUtf8Bytes(text);
    if (data.length > 32) {
      throw new Error('too long');
    }
    data = ethersUtils.padZeros(data, 32);
    return ethersUtils.hexlify(data);
  }

  bytes32ToNumber(bytes32) {
    const ethersUtils = this.get('web3').ethersUtils();
    return ethersUtils.bigNumberify(bytes32).toNumber();
  }

  numberToBytes32(num) {
    const ethersUtils = this.get('web3').ethersUtils();
    return (
      '0x' +
      ethersUtils
        .bigNumberify(num)
        .toHexString()
        .substring(2)
        .padStart(64, '0')
    );
  }

  hasContract(name) {
    return (
      Object.keys(contracts).indexOf(name) > -1 ||
      Object.keys(tokens).indexOf(name) > -1
    );
  }

  _getContractInfo(name, version = null) {
    if (!this.hasContract(name)) {
      throw new Error('Provided name "' + name + '" is not a contract');
    }

    const contractInfo = this._selectContractVersion(
      this._getCurrentNetworkMapping(name),
      version
    );

    if (contractInfo === null) {
      throw new Error(
        'Cannot find version ' + version + ' of contract ' + name
      );
    }

    return contractInfo;
  }

  _selectContractVersion(mapping, version) {
    if (version === null) {
      version = Math.max(...mapping.map(info => info.version));
    }

    let result = null;
    mapping.forEach(info => {
      if (info.version === version) {
        result = info;
      }
    });

    return result;
  }

  _getCurrentNetworkMapping(contractName = null) {
    const networkId = this.get('web3').networkId(),
      mapping = networks.filter(m => m.networkId === networkId);

    if (mapping.length < 1) {
      /* istanbul ignore next */
      throw new Error('Network ID ' + networkId + ' not found in mapping.');
    }

    if (!contractName) {
      return mapping;
    }

    if (typeof mapping[0].addresses[contractName] === 'undefined') {
      /* istanbul ignore next */
      throw new Error(
        'Contract ' +
          contractName +
          ' not found in mapping of network with ID ' +
          networkId
      );
    }

    return mapping[0].addresses[contractName];
  }
}
