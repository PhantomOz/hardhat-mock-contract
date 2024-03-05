// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;


contract Doppelganger {
    struct MockCall {
        bytes32 next;
        bool reverts;
        string revertReason;
        bytes returnValue;
    }
    mapping(bytes32 => MockCall) mockConfig;
    mapping(bytes32 => bytes32) tails;    
    bool receiveReverts;
    string receiveRevertReason;

    ////-----------Fallback------------------------------//
    fallback() external payable {
        MockCall memory mockCall = __internal__getMockCall();
        if (mockCall.reverts == true) {
            __internal__mockRevert(mockCall.revertReason);
        }
        __internal__mockReturn(mockCall.returnValue);
    }
    receive() payable external {
        require(receiveReverts == false, receiveRevertReason);
    }
    ////---------------Fallback-------------------------------------

    function __clearQueue(bytes32 _at) private {
        tails[_at] = _at;
        while(mockConfig[_at].next != "") {
            bytes32 next = mockConfig[_at].next;
            delete mockConfig[_at];
            _at = next;
        }
    }

    function __hardhat__queueRevert(bytes memory _data, string memory _reason) public {
        // get the root node of the linked list for this call
        bytes32 root = keccak256(_data);

        // get the 'address' of the node 'one after' the last node
        // this is where the new node will be inserted
        bytes32 tail = tails[root];
        if(tail == "") tail = keccak256(_data);

        // new tail is set to the hash of the current tail
        tails[root] = keccak256(abi.encodePacked(tail));

        // initialize the new node
        mockConfig[tail] = MockCall({
            next: tails[root], 
            reverts: true,
            revertReason: _reason,
            returnValue: ""
        });
    }

    function __hardhat__mockReverts(bytes memory _data, string memory _reason) public {
        __clearQueue(keccak256(_data));
        __hardhat__queueRevert(_data, _reason);
    }

    function __hardhat__queueReturn(bytes memory _data, bytes memory _value) public {
        // get the root node of the linked list for this call
        bytes32 root = keccak256(_data);

        // get the 'address' of the node 'one after' the last node
        // this is where the new node will be inserted
        bytes32 tail = tails[root];
        if(tail == "") tail = keccak256(_data);

        // new tail is set to the hash of the current tail
        tails[root] = keccak256(abi.encodePacked(tail));
        
        // initialize the new node
        mockConfig[tail] = MockCall({
            next: tails[root], 
            reverts: false,
            revertReason: "",
            returnValue: _value
        });
    }

    function __hardhat__mockReturns(bytes memory _data, bytes memory _value) public {
        __clearQueue(keccak256(_data));
        __hardhat__queueReturn(_data, _value);
    }

    function __hardhat__receiveReverts(string memory _reason) public {
        receiveReverts = true;
        receiveRevertReason = _reason;
    }

    function __hardhat__call(address _target, bytes calldata _data) external returns (bytes memory) {
      (bool succeeded, bytes memory returnValue) = _target.call(_data);
      require(succeeded, string(returnValue));
      return returnValue;
    }

    function __hardhat__staticcall(address _target, bytes calldata _data) external view returns (bytes memory) {
      (bool succeeded, bytes memory returnValue) = _target.staticcall(_data);
      require(succeeded, string(returnValue));
      return returnValue;
    }

    function __internal__getMockCall() private returns (MockCall memory mockCall) {
        // get the root node of the queue for this call
        bytes32 root = keccak256(msg.data);
        mockCall = mockConfig[root];
        if (mockCall.next != "") {
            // Mock method with specified arguments

            // If there is a next mock call, set it as the current mock call
            // We check if the next mock call is defined by checking if it has a 'next' variable defined
            // (next value is always defined, even if it's the last mock call)
            if(mockConfig[mockCall.next].next != ""){ // basically if it's not the last mock call
                mockConfig[root] = mockConfig[mockCall.next];
                delete mockConfig[mockCall.next];
            }
            return mockCall;
        }
        root = keccak256(abi.encodePacked(msg.sig));
        mockCall = mockConfig[root];
        if (mockCall.next != "") {
            // Mock method with any arguments
            if(mockConfig[mockCall.next].next != ""){ // same as above
                mockConfig[root] = mockConfig[mockCall.next];
                delete mockConfig[mockCall.next];
            }
            return mockCall;
        }
        revert("Mock on the method is not initialized");
    }

    function __internal__mockReturn(bytes memory ret) pure private {
        assembly {
            return (add(ret, 0x20), mload(ret))
        }
    }

    function __internal__mockRevert(string memory reason) pure private {
        revert(reason);
    }
}